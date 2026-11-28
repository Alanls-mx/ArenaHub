import {
  agendaQuerySchema,
  availabilitySchema,
  blockSchema,
  bookingCreateSchema,
  cancelSchema,
  recurrenceCreateSchema,
  recurrenceEstimateSchema,
  rescheduleSchema,
  reschedulePreviewSchema,
  transitionSchema,
  type Capability,
  recurrenceUpdateSchema,
  recurrenceResolveSchema,
} from '@arenahub/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AccessError, transaction } from '../identity/core.js';
import { session, type IdentityOptions } from '../identity/session.js';
import { civilDate, localToInstant } from '../shared/time/index.js';
import {
  createBlock,
  createReservation,
  idempotent,
  inspectSlot,
  lockReservation,
  notifyAgenda,
  rescheduleReservation,
  transitionReservation,
  type BookingContext,
} from './domain.js';
import { generateRecurrences } from './generate.js';
import { cancellationAmount } from './policy.js';
import { endRecurrence, replaceRecurrence } from './recurrence-admin.js';
import { firstMonthAmount } from './recurrence.js';
import { resolveConflict } from './resolve.js';

const idOf = (r: FastifyRequest) => z.object({ id: z.uuid() }).parse(r.params).id;
const keyOf = (r: FastifyRequest) => {
  const key = r.headers['idempotency-key'];
  if (typeof key !== 'string') throw new AccessError(400, 'VALIDATION_FAILED');
  return key;
};

export function bookingRoutes(app: FastifyInstance, pool: Pool, options: IdentityOptions) {
  function run<T>(
    r: FastifyRequest,
    cap: Capability,
    work: (db: PoolClient, ctx: BookingContext) => Promise<T>,
  ) {
    return transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      const slug = z.object({ slug: z.string().max(80) }).parse(r.params).slug;
      const org = (
        await db.query<{ id: string }>(
          'SELECT id FROM organizations WHERE slug=$1 AND active FOR SHARE',
          [slug],
        )
      ).rows[0]?.id;
      if (!org || (options.hostOrganization?.(r) && options.hostOrganization(r) !== org))
        throw new AccessError(404, 'NOT_FOUND');
      const member = (
        await db.query<{ is_owner: boolean }>(
          "SELECT is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
          [org, s.user_id],
        )
      ).rows[0];
      if (!member) throw new AccessError(404, 'NOT_FOUND');
      if (
        !member.is_owner &&
        !(
          await db.query(
            'SELECT 1 FROM membership_roles mr JOIN role_permissions rp USING(organization_id,role_id) WHERE mr.organization_id=$1 AND mr.user_id=$2 AND rp.code=$3 LIMIT 1',
            [org, s.user_id, cap],
          )
        ).rowCount
      )
        throw new AccessError(403, 'FORBIDDEN');
      return work(db, { org, actor: s.user_id, requestId: r.id });
    });
  }
  const base = '/orgs/:slug';
  app.get(base + '/availability', (r) =>
    run(r, 'reservations.read', async (db, ctx) => {
      const input = availabilitySchema.parse(r.query);
      const slot = await inspectSlot(db, ctx.org, { ...input, sportId: input.sportId ?? null });
      return {
        available: !slot.occupied,
        priceCents: slot.pricing?.totalCents ?? null,
        startAt: slot.startAt,
        endAt: slot.endAt,
      };
    }),
  );
  app.get(base + '/agenda', (r) =>
    run(r, 'reservations.read', async (db, ctx) => {
      const input = agendaQuerySchema.parse(r.query);
      if (civilDate(input.from).until(civilDate(input.to)).days > 7 || input.from > input.to)
        throw new AccessError(400, 'VALIDATION_FAILED');
      const zone = (
        await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [
          ctx.org,
        ])
      ).rows[0]!.timezone;
      const from = localToInstant(input.from + 'T00:00', zone).toString();
      const to = localToInstant(
        civilDate(input.to).add({ days: 1 }).toString() + 'T00:00',
        zone,
      ).toString();
      const reservations = (
        await db.query(
          `SELECT r.id,r.venue_id,r.customer_id,c.name AS customer_name,r.sport_id,r.start_at,r.end_at,
       to_char(r.start_at AT TIME ZONE o.timezone,'YYYY-MM-DD') AS local_date,
       to_char((r.end_at - interval '1 microsecond') AT TIME ZONE o.timezone,'YYYY-MM-DD') AS local_end_date,
       r.status,r.source,r.price_cents::text,r.version,r.notes,r.recurrence_id
       FROM reservations r JOIN customers c ON c.organization_id=r.organization_id AND c.id=r.customer_id
       JOIN organizations o ON o.id=r.organization_id
       WHERE r.organization_id=$1 AND r.start_at<$3 AND r.end_at>$2
       AND ($4::uuid IS NULL OR r.venue_id=$4) ORDER BY r.start_at,r.id LIMIT 1000`,
          [ctx.org, from, to, input.venueId ?? null],
        )
      ).rows.map((x) => ({ ...x, price_cents: Number(x.price_cents) }));
      const blocks = (
        await db.query(
          `SELECT b.id,b.venue_id,b.start_at,b.end_at,b.reason,
       to_char(b.start_at AT TIME ZONE o.timezone,'YYYY-MM-DD') AS local_date,
       to_char((b.end_at - interval '1 microsecond') AT TIME ZONE o.timezone,'YYYY-MM-DD') AS local_end_date
       FROM venue_blocks b JOIN organizations o ON o.id=b.organization_id
       WHERE b.organization_id=$1 AND b.cancelled_at IS NULL AND b.start_at<$3 AND b.end_at>$2
       AND ($4::uuid IS NULL OR b.venue_id=$4) ORDER BY b.start_at,b.id LIMIT 1000`,
          [ctx.org, from, to, input.venueId ?? null],
        )
      ).rows;
      return { reservations, blocks };
    }),
  );
  app.post(base + '/reservations', (r) =>
    run(r, 'reservations.create', (db, ctx) => {
      const input = bookingCreateSchema.parse(r.body);
      return idempotent(db, ctx, keyOf(r), 'POST', 'reservations', input, () =>
        createReservation(db, ctx, input),
      );
    }),
  );
  app.get(base + '/reservations/:id', (r) =>
    run(r, 'reservations.read', async (db, ctx) => {
      const row = (
        await db.query(
          `SELECT r.id,r.venue_id,r.customer_id,r.sport_id,r.start_at,r.end_at,r.status,r.source,
       r.price_cents::text,r.price_source,r.price_breakdown,r.policy_version,r.notes,r.version,
       r.created_at,r.confirmed_at,r.cancelled_at,r.cancellation_reason,r.no_show_at
       FROM reservations r WHERE r.organization_id=$1 AND r.id=$2`,
          [ctx.org, idOf(r)],
        )
      ).rows[0];
      if (!row) throw new AccessError(404, 'NOT_FOUND');
      return { ...row, price_cents: Number(row.price_cents) };
    }),
  );
  app.get(base + '/reservations/:id/history', (r) =>
    run(r, 'reservations.read', async (db, ctx) => {
      const id = idOf(r);
      if (
        !(
          await db.query('SELECT 1 FROM reservations WHERE organization_id=$1 AND id=$2', [
            ctx.org,
            id,
          ])
        ).rowCount
      )
        throw new AccessError(404, 'NOT_FOUND');
      return (
        await db.query(
          'SELECT id,action,from_status,to_status,changes,actor_user_id,created_at FROM reservation_history WHERE organization_id=$1 AND reservation_id=$2 ORDER BY created_at,id',
          [ctx.org, id],
        )
      ).rows;
    }),
  );
  for (const action of ['confirm', 'complete', 'no_show'] as const) {
    const capability = {
      confirm: 'reservations.confirm',
      complete: 'reservations.complete',
      no_show: 'reservations.no_show',
    }[action] as Capability;
    app.post(base + '/reservations/:id/' + action, (r) =>
      run(r, capability, (db, ctx) => {
        const id = idOf(r),
          input = transitionSchema.parse(r.body);
        return idempotent(
          db,
          ctx,
          keyOf(r),
          'POST',
          'reservations/' + id + '/' + action,
          input,
          () => transitionReservation(db, ctx, id, action, input.expectedVersion),
        );
      }),
    );
  }
  app.get(base + '/reservations/:id/cancellation-preview', (r) =>
    run(r, 'reservations.cancel', async (db, ctx) => {
      const row = (
        await db.query<{
          status: string;
          start_at: Date;
          price_cents: string;
          policy_version: number;
        }>(
          'SELECT status,start_at,price_cents::text,policy_version FROM reservations WHERE organization_id=$1 AND id=$2',
          [ctx.org, idOf(r)],
        )
      ).rows[0];
      if (!row) throw new AccessError(404, 'NOT_FOUND');
      const at = new Date();
      if (!['PENDING', 'CONFIRMED'].includes(row.status) || row.start_at <= at)
        throw new AccessError(409, 'INVALID_TRANSITION');
      const leadSeconds = Math.trunc((row.start_at.getTime() - at.getTime()) / 1000);
      return {
        originalPriceCents: Number(row.price_cents),
        policyPercent: leadSeconds >= 86_400 ? 0 : 50,
        feeCents: cancellationAmount(Number(row.price_cents), row.start_at, at),
        leadSeconds,
        policyVersion: row.policy_version,
        calculatedAt: at.toISOString(),
        startAt: row.start_at.toISOString(),
        note: 'Obrigação comercial calculada; não representa dinheiro já recebido.',
      };
    }),
  );
  app.post(base + '/reservations/:id/cancel', (r) => {
    const input = cancelSchema.parse(r.body);
    return run(
      r,
      input.waiveFee ? 'commercial_policy.override' : 'reservations.cancel',
      (db, ctx) => {
        const id = idOf(r);
        return idempotent(db, ctx, keyOf(r), 'POST', 'reservations/' + id + '/cancel', input, () =>
          transitionReservation(
            db,
            ctx,
            id,
            'cancel',
            input.expectedVersion,
            input.reason,
            input.waiveFee,
          ),
        );
      },
    );
  });
  app.get(base + '/reservations/:id/reschedule-preview', (r) =>
    run(r, 'reservations.reschedule', async (db, ctx) => {
      const input = reschedulePreviewSchema.parse(r.query);
      const id = idOf(r);
      const row = await lockReservation(db, ctx, id, input.venueId);
      if (row.version !== input.expectedVersion) throw new AccessError(409, 'STALE_VERSION');
      if (!['PENDING', 'CONFIRMED'].includes(row.status) || row.recurrence_id)
        throw new AccessError(409, 'INVALID_TRANSITION');
      const slot = await inspectSlot(db, ctx.org, { ...input, sportId: input.sportId ?? null });
      const occupied =
        (
          await db.query(
            "SELECT 1 FROM schedule_occupancies WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND active AND reservation_id IS DISTINCT FROM $3 AND period && tstzrange($4,$5,'[)') LIMIT 1",
            [ctx.org, slot.units, id, slot.startAt, slot.occupancyEnd],
          )
        ).rowCount !== 0;
      const newPrice = slot.pricing?.totalCents;
      if (newPrice === undefined) throw new AccessError(409, 'PRICE_UNAVAILABLE');
      return {
        available: !occupied,
        oldPriceCents: Number(row.price_cents),
        newPriceCents: newPrice,
        differenceCents: newPrice - Number(row.price_cents),
        oldStartAt: row.start_at.toISOString(),
        newStartAt: slot.startAt.toISOString(),
        newEndAt: slot.endAt.toISOString(),
        expectedVersion: row.version,
      };
    }),
  );
  app.post(base + '/reservations/:id/reschedule', (r) =>
    run(r, 'reservations.reschedule', (db, ctx) => {
      const id = idOf(r),
        input = rescheduleSchema.parse(r.body);
      return idempotent(
        db,
        ctx,
        keyOf(r),
        'POST',
        'reservations/' + id + '/reschedule',
        input,
        () => rescheduleReservation(db, ctx, id, input),
      );
    }),
  );
  app.get(base + '/blocks', (r) =>
    run(r, 'schedule_blocks.manage', async (db, ctx) => {
      const input = agendaQuerySchema.parse(r.query);
      if (civilDate(input.from).until(civilDate(input.to)).days > 7 || input.from > input.to)
        throw new AccessError(400, 'VALIDATION_FAILED');
      const zone = (
        await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [
          ctx.org,
        ])
      ).rows[0]!.timezone;
      const from = localToInstant(input.from + 'T00:00', zone).toString();
      const to = localToInstant(
        civilDate(input.to).add({ days: 1 }).toString() + 'T00:00',
        zone,
      ).toString();
      return (
        await db.query(
          'SELECT id,venue_id,start_at,end_at,reason,created_at FROM venue_blocks WHERE organization_id=$1 AND cancelled_at IS NULL AND start_at<$3 AND end_at>$2 AND ($4::uuid IS NULL OR venue_id=$4) ORDER BY start_at,id LIMIT 1000',
          [ctx.org, from, to, input.venueId ?? null],
        )
      ).rows;
    }),
  );
  app.post(base + '/blocks', (r) =>
    run(r, 'schedule_blocks.manage', (db, ctx) => {
      const input = blockSchema.parse(r.body);
      return idempotent(db, ctx, keyOf(r), 'POST', 'blocks', input, () =>
        createBlock(db, ctx, { ...input, sportId: null }),
      );
    }),
  );
  app.post(base + '/blocks/:id/cancel', (r) =>
    run(r, 'schedule_blocks.manage', (db, ctx) => {
      const id = idOf(r);
      return idempotent(db, ctx, keyOf(r), 'POST', 'blocks/' + id + '/cancel', {}, async () => {
        const initial = (
          await db.query<{ venue_id: string }>(
            'SELECT venue_id FROM venue_blocks WHERE organization_id=$1 AND id=$2',
            [ctx.org, id],
          )
        ).rows[0];
        if (!initial) throw new AccessError(404, 'NOT_FOUND');
        // Follow the same organization -> venue -> origin lock order used by bookings.
        await db.query('SELECT id FROM venues WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
          ctx.org,
          initial.venue_id,
        ]);
        const row = (
          await db.query<{ cancelled_at: Date | null }>(
            'SELECT cancelled_at FROM venue_blocks WHERE organization_id=$1 AND id=$2 FOR UPDATE',
            [ctx.org, id],
          )
        ).rows[0];
        if (row?.cancelled_at) throw new AccessError(409, 'INVALID_TRANSITION');
        await db.query(
          'UPDATE venue_blocks SET cancelled_at=now(),cancelled_by=$3 WHERE organization_id=$1 AND id=$2',
          [ctx.org, id, ctx.actor],
        );
        await db.query(
          'UPDATE schedule_occupancies SET active=false WHERE organization_id=$1 AND block_id=$2 AND active',
          [ctx.org, id],
        );
        await notifyAgenda(db, ctx.org, 'block.changed');
        return { id, cancelled: true };
      });
    }),
  );
  app.post(base + '/recurrence-contracts', async (r) => {
    const result = await run(r, 'recurrences.manage', (db, ctx) => {
      const input = recurrenceCreateSchema.parse(r.body);
      return idempotent(db, ctx, keyOf(r), 'POST', 'recurrence-contracts', input, async () => {
        if (
          new Set(input.rules.map((x) => x.weekday)).size !== input.rules.length ||
          (input.endsOn && input.endsOn < input.startsOn) ||
          (input.billingMode === 'MONTHLY') !== (input.monthlyAmountCents !== null)
        )
          throw new AccessError(400, 'VALIDATION_FAILED');
        await db.query(
          'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
          [ctx.org, input.venueId],
        );
        if (
          !(
            await db.query(
              'SELECT 1 FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
              [ctx.org, input.venueId],
            )
          ).rowCount ||
          !(
            await db.query(
              'SELECT 1 FROM customers WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
              [ctx.org, input.customerId],
            )
          ).rowCount
        )
          throw new AccessError(404, 'NOT_FOUND');
        if (
          input.sportId &&
          !(
            await db.query(
              'SELECT 1 FROM venue_sports WHERE organization_id=$1 AND venue_id=$2 AND sport_id=$3',
              [ctx.org, input.venueId, input.sportId],
            )
          ).rowCount
        )
          throw new AccessError(404, 'NOT_FOUND');
        const contract = (
          await db.query<{ id: string }>(
            'INSERT INTO recurrence_contracts(organization_id,customer_id,billing_mode) VALUES($1,$2,$3) RETURNING id',
            [ctx.org, input.customerId, input.billingMode],
          )
        ).rows[0]!;
        const first = input.rules[0]!;
        const version = (
          await db.query<{ id: string }>(
            `INSERT INTO recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
         duration_minutes,starts_on,ends_on,effective_from,price_cents,monthly_amount_cents)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11) RETURNING id`,
            [
              ctx.org,
              contract.id,
              input.venueId,
              input.sportId,
              first.weekday,
              first.startTime,
              first.durationMinutes,
              input.startsOn,
              input.endsOn,
              input.priceCents,
              input.monthlyAmountCents,
            ],
          )
        ).rows[0]!;
        for (const rule of input.rules)
          await db.query(
            'INSERT INTO recurrence_rules(organization_id,recurrence_id,weekday,start_time,duration_minutes) VALUES($1,$2,$3,$4,$5)',
            [ctx.org, version.id, rule.weekday, rule.startTime, rule.durationMinutes],
          );
        await db.query(
          'INSERT INTO audit_logs(actor_id,organization_id,action,entity,request_id) VALUES($1,$2,$3,$4,$5)',
          [ctx.actor, ctx.org, 'recurrence.contract.created', contract.id, ctx.requestId],
        );
        return {
          id: contract.id,
          recurrenceId: version.id,
          generation: 'PENDING',
          firstMonthAmountCents:
            input.monthlyAmountCents === null
              ? null
              : firstMonthAmount(
                  input.monthlyAmountCents,
                  input.startsOn,
                  input.rules.map((x) => x.weekday),
                ),
        };
      });
    });
    // The periodic worker is the durable fallback if this immediate attempt fails.
    await generateRecurrences(pool, result.id).catch((error: unknown) => {
      r.log.error(
        { code: (error as { code?: string })?.code },
        'initial recurrence generation failed',
      );
    });
    return result;
  });
  app.get(base + '/recurrence-contracts/first-month-preview', (r) =>
    run(r, 'recurrences.manage', async () => {
      const input = recurrenceEstimateSchema.parse(r.query);
      const weekdays = input.weekdays.split(',').map(Number);
      if (new Set(weekdays).size !== weekdays.length)
        throw new AccessError(400, 'VALIDATION_FAILED');
      return {
        firstMonthAmountCents: firstMonthAmount(input.monthlyAmountCents, input.startsOn, weekdays),
      };
    }),
  );
  app.get(base + '/recurrence-contracts', (r) =>
    run(r, 'recurrences.read', async (db, ctx) => {
      const search = z
        .object({ search: z.string().trim().max(120).default('') })
        .parse(r.query).search;
      return (
        await db.query(
          `SELECT c.id,c.customer_id,cu.name AS customer_name,c.billing_mode,c.status,c.created_at,
       r.id AS recurrence_id,r.venue_id,v.name AS venue_name,r.sport_id,r.starts_on::text,
       r.ends_on::text,r.price_cents::text,r.monthly_amount_cents::text,r.generated_until::text,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday',rr.weekday,'startTime',to_char(rr.start_time,'HH24:MI'),'durationMinutes',rr.duration_minutes) ORDER BY rr.weekday)
        FROM recurrence_rules rr WHERE rr.organization_id=r.organization_id AND rr.recurrence_id=r.id),'[]'::jsonb) AS rules,
       (SELECT count(*)::int FROM reservations x WHERE x.organization_id=r.organization_id AND x.recurrence_id=r.id AND x.start_at>now() AND x.status IN ('PENDING','CONFIRMED')) AS future_count,
       (SELECT count(*)::int FROM recurrence_exceptions e WHERE e.organization_id=r.organization_id AND e.recurrence_id=r.id AND e.kind='CONFLICT') AS conflict_count
       FROM recurrence_contracts c JOIN recurrences r ON r.organization_id=c.organization_id AND r.contract_id=c.id
       JOIN customers cu ON cu.organization_id=c.organization_id AND cu.id=c.customer_id
       JOIN venues v ON v.organization_id=r.organization_id AND v.id=r.venue_id
       WHERE c.organization_id=$1 AND ($2='' OR cu.name ILIKE '%'||$2||'%' OR v.name ILIKE '%'||$2||'%')
       ORDER BY c.created_at DESC,r.starts_on DESC LIMIT 200`,
          [ctx.org, search],
        )
      ).rows;
    }),
  );
  app.get(base + '/recurrence-contracts/:id/history', (r) =>
    run(r, 'recurrences.read', async (db, ctx) => {
      const id = idOf(r);
      if (
        !(
          await db.query('SELECT 1 FROM recurrence_contracts WHERE organization_id=$1 AND id=$2', [
            ctx.org,
            id,
          ])
        ).rowCount
      )
        throw new AccessError(404, 'NOT_FOUND');
      return (
        await db.query(
          "SELECT id,action,actor_id,created_at FROM audit_logs WHERE organization_id=$1 AND entity=$2 AND action LIKE 'recurrence.%' ORDER BY created_at,id",
          [ctx.org, id],
        )
      ).rows;
    }),
  );
  app.post(base + '/recurrence-contracts/:id/versions', async (r) => {
    const id = idOf(r),
      input = recurrenceUpdateSchema.parse(r.body);
    const result = await run(r, 'recurrences.manage', (db, ctx) =>
      idempotent(db, ctx, keyOf(r), 'POST', 'recurrence-contracts/' + id + '/versions', input, () =>
        replaceRecurrence(db, ctx, id, input),
      ),
    );
    await generateRecurrences(pool, id).catch((error: unknown) =>
      r.log.error({ code: (error as { code?: string })?.code }, 'version generation failed'),
    );
    return result;
  });
  app.post(base + '/recurrence-contracts/:id/end', (r) =>
    run(r, 'recurrences.manage', (db, ctx) => {
      const id = idOf(r);
      return idempotent(db, ctx, keyOf(r), 'POST', 'recurrence-contracts/' + id + '/end', {}, () =>
        endRecurrence(db, ctx, id),
      );
    }),
  );
  app.get(base + '/recurrence-conflicts', (r) =>
    run(
      r,
      'recurrences.read',
      async (db, ctx) =>
        (
          await db.query(
            `SELECT x.id,x.recurrence_id,x.occurrence_date::text,x.reason,x.resolved_at,
       r.contract_id,r.venue_id,c.customer_id
       FROM recurrence_exceptions x JOIN recurrences r ON r.organization_id=x.organization_id AND r.id=x.recurrence_id
       JOIN recurrence_contracts c ON c.organization_id=r.organization_id AND c.id=r.contract_id
       WHERE x.organization_id=$1 AND x.kind='CONFLICT' ORDER BY x.occurrence_date DESC LIMIT 200`,
            [ctx.org],
          )
        ).rows,
    ),
  );
  app.post(base + '/recurrence-conflicts/:id/resolve', async (r) => {
    const id = idOf(r),
      input = recurrenceResolveSchema.parse(r.body);
    const result = await run(r, 'recurrences.manage', (db, ctx) =>
      idempotent(db, ctx, keyOf(r), 'POST', 'recurrence-conflicts/' + id + '/resolve', input, () =>
        resolveConflict(db, ctx, id, input),
      ),
    );
    if (input.action === 'RETRY')
      await generateRecurrences(pool, result.contractId).catch((error: unknown) =>
        r.log.error({ code: (error as { code?: string })?.code }, 'conflict retry failed'),
      );
    return result;
  });
}
