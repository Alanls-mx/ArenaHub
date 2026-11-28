import type { recurrenceUpdateSchema } from '@arenahub/contracts';
import { Temporal } from '@js-temporal/polyfill';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { AccessError } from '../identity/core.js';
import { lockVenues, notifyAgenda, type BookingContext } from './domain.js';

type Version = { id: string; venue_id: string; starts_on: string; ends_on: string | null };
async function cancelFuture(
  db: PoolClient,
  ctx: BookingContext,
  recurrenceId: string,
  effectiveFrom: string,
) {
  const protectedRows = (
    await db.query<{ occurrence_date: string }>(
      `SELECT r.occurrence_date::text FROM reservations r WHERE r.organization_id=$1
     AND r.recurrence_id=$2 AND r.occurrence_date>=$3::date AND r.start_at>now()
     AND r.status IN ('PENDING','CONFIRMED')
     AND EXISTS (SELECT 1 FROM reservation_history h WHERE h.organization_id=r.organization_id
       AND h.reservation_id=r.id AND h.action<>'generated')`,
      [ctx.org, recurrenceId, effectiveFrom],
    )
  ).rows;
  if (protectedRows.length) throw new AccessError(409, 'RECURRENCE_REQUIRES_RESOLUTION');
  const rows = (
    await db.query<{ id: string; status: string }>(
      `UPDATE reservations SET status='CANCELLED',cancelled_at=now(),cancelled_by=$4,
     cancellation_reason='Versão recorrente substituída',version=version+1,updated_at=now()
     WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date>=$3::date AND start_at>now()
     AND status IN ('PENDING','CONFIRMED') RETURNING id,status`,
      [ctx.org, recurrenceId, effectiveFrom, ctx.actor],
    )
  ).rows;
  for (const row of rows) {
    await db.query(
      'UPDATE schedule_occupancies SET active=false WHERE organization_id=$1 AND reservation_id=$2 AND active',
      [ctx.org, row.id],
    );
    await db.query(
      "INSERT INTO reservation_history(organization_id,reservation_id,action,from_status,to_status,changes,actor_user_id) VALUES($1,$2,'recurrence.versioned',$3,'CANCELLED',$4,$5)",
      [ctx.org, row.id, row.status, JSON.stringify({ effectiveFrom }), ctx.actor],
    );
  }
  return rows.length;
}
export async function replaceRecurrence(
  db: PoolClient,
  ctx: BookingContext,
  contractId: string,
  input: z.infer<typeof recurrenceUpdateSchema>,
) {
  const dateNow = Temporal.Now.zonedDateTimeISO(
    (
      await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [
        ctx.org,
      ])
    ).rows[0]!.timezone,
  )
    .toPlainDate()
    .toString();
  if (
    input.effectiveFrom <= dateNow ||
    (input.endsOn && input.endsOn < input.effectiveFrom) ||
    new Set(input.rules.map((r) => r.weekday)).size !== input.rules.length
  )
    throw new AccessError(400, 'VALIDATION_FAILED');
  const initial = (
    await db.query<Version>(
      `SELECT id,venue_id,starts_on::text,ends_on::text FROM recurrences
     WHERE organization_id=$1 AND contract_id=$2 AND starts_on<=$3::date
     AND (ends_on IS NULL OR ends_on>=$3::date)`,
      [ctx.org, contractId, input.effectiveFrom],
    )
  ).rows[0];
  if (!initial || input.effectiveFrom <= initial.starts_on)
    throw new AccessError(409, 'RECURRENCE_REQUIRES_RESOLUTION');
  await lockVenues(db, ctx.org, [initial.venue_id, input.venueId]);
  const contract = (
    await db.query<{ customer_id: string; billing_mode: string }>(
      "SELECT customer_id,billing_mode FROM recurrence_contracts WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",
      [ctx.org, contractId],
    )
  ).rows[0];
  if (!contract) throw new AccessError(404, 'NOT_FOUND');
  if ((contract.billing_mode === 'MONTHLY') !== (input.monthlyAmountCents !== null))
    throw new AccessError(400, 'VALIDATION_FAILED');
  const old = (
    await db.query<Version>(
      `SELECT id,venue_id,starts_on::text,ends_on::text FROM recurrences
     WHERE organization_id=$1 AND id=$2 AND contract_id=$3 FOR UPDATE`,
      [ctx.org, initial.id, contractId],
    )
  ).rows[0];
  if (
    !old ||
    old.venue_id !== initial.venue_id ||
    (old.ends_on && old.ends_on < input.effectiveFrom)
  )
    throw new AccessError(409, 'STALE_VERSION');
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
  const cancelled = await cancelFuture(db, ctx, old.id, input.effectiveFrom);
  const previousEnd = Temporal.PlainDate.from(input.effectiveFrom).subtract({ days: 1 }).toString();
  await db.query('UPDATE recurrences SET ends_on=$3 WHERE organization_id=$1 AND id=$2', [
    ctx.org,
    old.id,
    previousEnd,
  ]);
  const first = input.rules[0]!;
  const version = (
    await db.query<{ id: string }>(
      `INSERT INTO recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
     duration_minutes,starts_on,ends_on,effective_from,price_cents,monthly_amount_cents,previous_recurrence_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11,$12) RETURNING id`,
      [
        ctx.org,
        contractId,
        input.venueId,
        input.sportId,
        first.weekday,
        first.startTime,
        first.durationMinutes,
        input.effectiveFrom,
        input.endsOn,
        input.priceCents,
        input.monthlyAmountCents,
        old.id,
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
    [ctx.actor, ctx.org, 'recurrence.versioned', contractId, ctx.requestId],
  );
  await notifyAgenda(db, ctx.org, 'recurrence.changed');
  return { id: contractId, recurrenceId: version.id, cancelledFuture: cancelled };
}

export async function endRecurrence(db: PoolClient, ctx: BookingContext, contractId: string) {
  const venues = (
    await db.query<{ venue_id: string }>(
      `SELECT DISTINCT r.venue_id FROM recurrences r JOIN venues v ON v.organization_id=r.organization_id AND v.id=r.venue_id
     WHERE r.organization_id=$1 AND r.contract_id=$2 AND v.archived_at IS NULL ORDER BY r.venue_id`,
      [ctx.org, contractId],
    )
  ).rows.map((r) => r.venue_id);
  if (
    !(
      await db.query('SELECT 1 FROM recurrence_contracts WHERE organization_id=$1 AND id=$2', [
        ctx.org,
        contractId,
      ])
    ).rowCount
  )
    throw new AccessError(404, 'NOT_FOUND');
  await lockVenues(db, ctx.org, venues);
  const updated = await db.query(
    "UPDATE recurrence_contracts SET status='ENDED',ended_at=now(),ended_by=$3 WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'",
    [ctx.org, contractId, ctx.actor],
  );
  if (!updated.rowCount) throw new AccessError(409, 'INVALID_TRANSITION');
  const versions = (
    await db.query<{ id: string }>(
      'SELECT id FROM recurrences WHERE organization_id=$1 AND contract_id=$2',
      [ctx.org, contractId],
    )
  ).rows;
  let cancelledFuture = 0;
  for (const version of versions)
    cancelledFuture += await cancelFuture(
      db,
      ctx,
      version.id,
      Temporal.Now.zonedDateTimeISO(
        (
          await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [
            ctx.org,
          ])
        ).rows[0]!.timezone,
      )
        .toPlainDate()
        .toString(),
    );
  await db.query(
    'INSERT INTO audit_logs(actor_id,organization_id,action,entity,request_id) VALUES($1,$2,$3,$4,$5)',
    [ctx.actor, ctx.org, 'recurrence.ended', contractId, ctx.requestId],
  );
  await notifyAgenda(db, ctx.org, 'recurrence.changed');
  return { id: contractId, status: 'ENDED', cancelledFuture };
}
