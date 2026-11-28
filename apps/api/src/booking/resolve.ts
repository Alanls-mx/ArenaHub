import type { recurrenceResolveSchema } from '@arenahub/contracts';
import { Temporal } from '@js-temporal/polyfill';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { AccessError } from '../identity/core.js';
import { inspectSlot, lockVenues, notifyAgenda, type BookingContext } from './domain.js';

type Conflict = {
  id: string;
  recurrence_id: string;
  occurrence_date: string;
  kind: string;
  resolved_at: Date | null;
  venue_id: string;
  sport_id: string | null;
  customer_id: string;
  price_cents: string;
  contract_id: string;
};

export async function resolveConflict(
  db: PoolClient,
  ctx: BookingContext,
  id: string,
  input: z.infer<typeof recurrenceResolveSchema>,
) {
  const initial = (
    await db.query<Conflict>(
      `SELECT x.id,x.recurrence_id,x.occurrence_date::text,x.kind,x.resolved_at,
     r.venue_id,r.sport_id,r.price_cents::text,r.contract_id,c.customer_id
     FROM recurrence_exceptions x JOIN recurrences r ON r.organization_id=x.organization_id AND r.id=x.recurrence_id
     JOIN recurrence_contracts c ON c.organization_id=r.organization_id AND c.id=r.contract_id
     WHERE x.organization_id=$1 AND x.id=$2`,
      [ctx.org, id],
    )
  ).rows[0];
  if (!initial) throw new AccessError(404, 'NOT_FOUND');
  await lockVenues(db, ctx.org, [initial.venue_id]);
  const conflict = (
    await db.query<Conflict>(
      `SELECT x.id,x.recurrence_id,x.occurrence_date::text,x.kind,x.resolved_at,
     r.venue_id,r.sport_id,r.price_cents::text,r.contract_id,c.customer_id
     FROM recurrence_exceptions x JOIN recurrences r ON r.organization_id=x.organization_id AND r.id=x.recurrence_id
     JOIN recurrence_contracts c ON c.organization_id=r.organization_id AND c.id=r.contract_id
     WHERE x.organization_id=$1 AND x.id=$2 FOR UPDATE OF x`,
      [ctx.org, id],
    )
  ).rows[0];
  if (!conflict || conflict.kind !== 'CONFLICT' || conflict.resolved_at)
    throw new AccessError(409, 'INVALID_TRANSITION');
  if (input.action === 'RETRY') {
    await db.query('DELETE FROM recurrence_exceptions WHERE organization_id=$1 AND id=$2', [
      ctx.org,
      id,
    ]);
  } else if (input.action === 'SKIP') {
    await db.query(
      "UPDATE recurrence_exceptions SET kind='SKIPPED',reason=$3,resolved_at=now(),resolved_by=$4 WHERE organization_id=$1 AND id=$2",
      [ctx.org, id, input.reason, ctx.actor],
    );
  } else {
    const zone = (
      await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [
        ctx.org,
      ])
    ).rows[0]?.timezone;
    if (
      !zone ||
      Temporal.PlainDate.compare(
        Temporal.PlainDate.from(input.date),
        Temporal.Now.zonedDateTimeISO(zone).toPlainDate(),
      ) < 0
    )
      throw new AccessError(400, 'VALIDATION_FAILED');
    const slot = await inspectSlot(
      db,
      ctx.org,
      {
        venueId: conflict.venue_id,
        sportId: conflict.sport_id,
        date: input.date,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
      },
      false,
    );
    if (slot.occupied) throw new AccessError(409, 'SLOT_UNAVAILABLE');
    const reservation = (
      await db.query<{ id: string }>(
        `INSERT INTO reservations(organization_id,venue_id,sport_id,customer_id,recurrence_id,
       occurrence_date,start_at,end_at,status,source,price_cents,price_source,price_breakdown,
       created_by,confirmed_at,policy_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMED','RECURRENCE',$9,'RECURRENCE','[]',$10,now(),1)
       RETURNING id`,
        [
          ctx.org,
          conflict.venue_id,
          conflict.sport_id,
          conflict.customer_id,
          conflict.recurrence_id,
          conflict.occurrence_date,
          slot.startAt,
          slot.endAt,
          conflict.price_cents,
          ctx.actor,
        ],
      )
    ).rows[0]!;
    for (const unit of slot.units)
      await db.query(
        'INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
        [ctx.org, unit, slot.startAt, slot.occupancyEnd, reservation.id],
      );
    await db.query(
      "INSERT INTO reservation_history(organization_id,reservation_id,action,to_status,changes,actor_user_id) VALUES($1,$2,'recurrence.moved','CONFIRMED',$3,$4)",
      [
        ctx.org,
        reservation.id,
        JSON.stringify({
          originalDate: conflict.occurrence_date,
          newDate: input.date,
          reason: input.reason,
        }),
        ctx.actor,
      ],
    );
    await db.query(
      "UPDATE recurrence_exceptions SET kind='MOVED',reservation_id=$3,reason=$4,resolved_at=now(),resolved_by=$5 WHERE organization_id=$1 AND id=$2",
      [ctx.org, id, reservation.id, input.reason, ctx.actor],
    );
  }
  await db.query(
    'INSERT INTO audit_logs(actor_id,organization_id,action,entity,request_id) VALUES($1,$2,$3,$4,$5)',
    [ctx.actor, ctx.org, 'recurrence.conflict.' + input.action.toLowerCase(), id, ctx.requestId],
  );
  await notifyAgenda(db, ctx.org, 'recurrence.changed');
  return { id, action: input.action, contractId: conflict.contract_id };
}
