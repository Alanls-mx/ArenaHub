import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { PoolClient } from 'pg';
import { AccessError } from '../identity/core.js';
import { quote, type PriceRule } from '../operations/rules.js';
import { civilDate, localToInstant, operationalWindow } from '../shared/time/index.js';
import { cancellationAmount, noShowAmount, POLICY_VERSION } from './policy.js';

export type BookingContext = { org: string; actor: string; requestId: string };
export type Slot = {
  venueId: string;
  sportId: string | null;
  date: string;
  startTime: string;
  durationMinutes: number;
  ambiguousTimeChoice?: 'earlier' | 'later' | undefined;
};
type Reservation = {
  id: string;
  venue_id: string;
  sport_id: string | null;
  customer_id: string;
  status: string;
  start_at: Date;
  end_at: Date;
  price_cents: string;
  version: number;
  policy_version: number;
  recurrence_id: string | null;
};
type Venue = {
  id: string;
  default_price_per_hour_cents: string | null;
  slot_minutes: number | null;
  min_minutes: number | null;
  max_minutes: number | null;
  buffer_minutes: number | null;
};
const fail = (
  status: 400 | 404 | 409,
  code: ConstructorParameters<typeof AccessError>[1],
): never => {
  throw new AccessError(status, code);
};

export async function lockVenues(db: PoolClient, org: string, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    const found = await db.query(
      'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
      [org, id],
    );
    if (!found.rowCount) fail(404, 'NOT_FOUND');
  }
}

async function venueForSlot(db: PoolClient, org: string, slot: Slot): Promise<Venue> {
  const venue = (
    await db.query<Venue>(
      'SELECT id,default_price_per_hour_cents::text,slot_minutes,min_minutes,max_minutes,buffer_minutes FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
      [org, slot.venueId],
    )
  ).rows[0];
  if (!venue) throw new AccessError(404, 'NOT_FOUND');
  if (
    slot.durationMinutes < (venue.min_minutes ?? 1) ||
    slot.durationMinutes > (venue.max_minutes ?? 1440)
  )
    fail(400, 'VALIDATION_FAILED');
  const [hour, minute] = slot.startTime.split(':').map(Number);
  if (((hour ?? 0) * 60 + (minute ?? 0)) % (venue.slot_minutes ?? 15) !== 0)
    fail(400, 'VALIDATION_FAILED');
  if (
    slot.sportId &&
    !(
      await db.query(
        'SELECT 1 FROM venue_sports vs JOIN sports s ON s.organization_id=vs.organization_id AND s.id=vs.sport_id WHERE vs.organization_id=$1 AND vs.venue_id=$2 AND vs.sport_id=$3 AND s.archived_at IS NULL',
        [org, slot.venueId, slot.sportId],
      )
    ).rowCount
  )
    fail(404, 'NOT_FOUND');
  return venue;
}

async function slotTimes(db: PoolClient, org: string, slot: Slot) {
  const zone = (
    await db.query<{ timezone: string }>('SELECT timezone FROM organizations WHERE id=$1', [org])
  ).rows[0]?.timezone;
  if (!zone) throw new AccessError(404, 'NOT_FOUND');
  let start!: Temporal.Instant;
  try {
    start = localToInstant(`${slot.date}T${slot.startTime}:00`, zone, slot.ambiguousTimeChoice);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    fail(400, message.includes('AMBIGUOUS') ? 'AMBIGUOUS_LOCAL_TIME' : 'INVALID_LOCAL_TIME');
  }
  const end = start.add({ minutes: slot.durationMinutes });
  const day = civilDate(slot.date);
  const days = [day.subtract({ days: 1 }), day];
  const windows: { start: Temporal.Instant; end: Temporal.Instant }[] = [];
  for (const d of days) {
    const date = d.toString();
    const exceptions = (
      await db.query<{
        venue_id: string | null;
        kind: string;
        open_time: string | null;
        close_time: string | null;
      }>(
        "SELECT venue_id,kind,to_char(open_time,'HH24:MI') AS open_time,to_char(close_time,'HH24:MI') AS close_time FROM calendar_exceptions WHERE organization_id=$1 AND date=$2 AND (venue_id IS NULL OR venue_id=$3) ORDER BY venue_id NULLS FIRST",
        [org, date, slot.venueId],
      )
    ).rows;
    const global = exceptions.find((x) => x.venue_id === null);
    const local = exceptions.find((x) => x.venue_id === slot.venueId);
    if (global?.kind === 'CLOSED' || local?.kind === 'CLOSED') continue;
    const exception = local ?? global;
    const shifts =
      exception?.kind === 'SPECIAL_HOURS'
        ? [
            {
              open_time: exception.open_time!,
              close_time: exception.close_time!,
              spans_full_day: false,
            },
          ]
        : (
            await db.query<{ open_time: string; close_time: string; spans_full_day: boolean }>(
              "SELECT to_char(open_time,'HH24:MI') AS open_time,to_char(close_time,'HH24:MI') AS close_time,spans_full_day FROM operating_hours WHERE organization_id=$1 AND venue_id=$2 AND weekday=$3",
              [org, slot.venueId, d.dayOfWeek % 7],
            )
          ).rows;
    for (const shift of shifts) {
      try {
        windows.push(
          operationalWindow(date, shift.open_time, shift.close_time, zone, shift.spans_full_day),
        );
      } catch {
        throw new AccessError(400, 'INVALID_LOCAL_TIME');
      }
    }
  }
  if (
    !windows.some(
      (w) =>
        Temporal.Instant.compare(w.start, start) <= 0 && Temporal.Instant.compare(end, w.end) <= 0,
    )
  )
    fail(409, 'OUTSIDE_OPERATING_HOURS');
  return { startAt: new Date(start.epochMilliseconds), endAt: new Date(end.epochMilliseconds) };
}

async function quoteSlot(db: PoolClient, org: string, slot: Slot, venue: Venue) {
  const rows = (
    await db.query<{
      id: string;
      sport_id: string | null;
      specific_date: string | null;
      weekday: number | null;
      start_minute: number;
      end_minute: number;
      price_per_hour_cents: string;
      valid_from: string | null;
      valid_until: string | null;
    }>(
      'SELECT id,sport_id,specific_date::text,weekday,start_minute,end_minute,price_per_hour_cents::text,valid_from::text,valid_until::text FROM pricing_rules WHERE organization_id=$1 AND venue_id=$2 AND archived_at IS NULL',
      [org, slot.venueId],
    )
  ).rows;
  const rules: PriceRule[] = rows.map((r) => ({
    id: r.id,
    sportId: r.sport_id,
    specificDate: r.specific_date,
    weekday: r.weekday,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    pricePerHourCents: Number(r.price_per_hour_cents),
    validFrom: r.valid_from,
    validUntil: r.valid_until,
  }));
  const result = quote({
    date: slot.date,
    startTime: slot.startTime,
    durationMinutes: slot.durationMinutes,
    sportId: slot.sportId ?? undefined,
    defaultPricePerHourCents:
      venue.default_price_per_hour_cents == null
        ? null
        : Number(venue.default_price_per_hour_cents),
    rules,
  });
  if (!result.available) fail(409, 'PRICE_UNAVAILABLE');
  return result;
}

export async function inspectSlot(db: PoolClient, org: string, slot: Slot, price = true) {
  const venue = await venueForSlot(db, org, slot);
  const times = await slotTimes(db, org, slot);
  const units = (
    await db.query<{ unit_id: string }>(
      'SELECT l.unit_id FROM venue_unit_links l JOIN venue_units u ON u.organization_id=l.organization_id AND u.id=l.unit_id WHERE l.organization_id=$1 AND l.venue_id=$2 AND u.archived_at IS NULL ORDER BY l.unit_id',
      [org, slot.venueId],
    )
  ).rows.map((r) => r.unit_id);
  if (!units.length) fail(409, 'VENUE_UNITS_IN_USE');
  const occupancyEnd = new Date(times.endAt.getTime() + (venue.buffer_minutes ?? 0) * 60_000);
  const occupied =
    (
      await db.query(
        "SELECT 1 FROM schedule_occupancies WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND active AND period && tstzrange($3,$4,'[)') LIMIT 1",
        [org, units, times.startAt, occupancyEnd],
      )
    ).rowCount !== 0;
  const pricing = price ? await quoteSlot(db, org, slot, venue) : null;
  return { ...times, occupancyEnd, units, occupied, pricing };
}

async function history(
  db: PoolClient,
  ctx: BookingContext,
  reservationId: string,
  action: string,
  from: string | null,
  to: string | null,
  changes: unknown,
) {
  await db.query(
    'INSERT INTO reservation_history(organization_id,reservation_id,action,from_status,to_status,changes,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ctx.org, reservationId, action, from, to, JSON.stringify(changes), ctx.actor],
  );
  await db.query(
    'INSERT INTO audit_logs(actor_id,organization_id,action,entity,request_id) VALUES($1,$2,$3,$4,$5)',
    [ctx.actor, ctx.org, 'reservation.' + action, reservationId, ctx.requestId],
  );
}

export async function notifyAgenda(db: PoolClient, org: string, kind: string) {
  await db.query('SELECT pg_notify($1,$2)', ['arenahub_agenda', JSON.stringify({ org, kind })]);
}

async function occupy(
  db: PoolClient,
  ctx: BookingContext,
  origin: 'reservation' | 'block',
  id: string,
  units: string[],
  start: Date,
  end: Date,
) {
  for (const unit of units)
    await db.query(
      `INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,${origin}_id) VALUES($1,$2,$3,$4,$5)`,
      [ctx.org, unit, start, end, id],
    );
}

export async function createReservation(
  db: PoolClient,
  ctx: BookingContext,
  input: Slot & {
    customerId: string;
    initialStatus: 'PENDING' | 'CONFIRMED';
    source: 'ADMIN' | 'IN_PERSON';
    notes: string;
  },
) {
  await lockVenues(db, ctx.org, [input.venueId]);
  if (
    !(
      await db.query(
        'SELECT 1 FROM customers WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
        [ctx.org, input.customerId],
      )
    ).rowCount
  )
    fail(404, 'NOT_FOUND');
  const slot = await inspectSlot(db, ctx.org, input);
  if (slot.occupied) fail(409, 'SLOT_UNAVAILABLE');
  const pricing = slot.pricing!;
  const priceSource = pricing.segments.some((s) => s.ruleId) ? 'RULE' : 'DEFAULT';
  const row = (
    await db.query<{ id: string }>(
      'INSERT INTO reservations(organization_id,venue_id,sport_id,customer_id,start_at,end_at,status,source,price_cents,price_source,pricing_rule_id,price_breakdown,notes,created_by,confirmed_at,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id',
      [
        ctx.org,
        input.venueId,
        input.sportId,
        input.customerId,
        slot.startAt,
        slot.endAt,
        input.initialStatus,
        input.source,
        pricing.totalCents,
        priceSource,
        pricing.segments.length === 1 ? pricing.segments[0]!.ruleId : null,
        JSON.stringify(pricing.segments),
        input.notes,
        ctx.actor,
        input.initialStatus === 'CONFIRMED' ? new Date() : null,
        POLICY_VERSION,
      ],
    )
  ).rows[0]!;
  await occupy(db, ctx, 'reservation', row.id, slot.units, slot.startAt, slot.occupancyEnd);
  await history(db, ctx, row.id, 'created', null, input.initialStatus, {
    source: input.source,
    priceCents: pricing.totalCents,
  });
  await notifyAgenda(db, ctx.org, 'reservation.changed');
  return { id: row.id, status: input.initialStatus, priceCents: pricing.totalCents, version: 1 };
}

export async function lockReservation(
  db: PoolClient,
  ctx: BookingContext,
  id: string,
  extraVenue?: string,
): Promise<Reservation> {
  const initial = (
    await db.query<{ venue_id: string }>(
      'SELECT venue_id FROM reservations WHERE organization_id=$1 AND id=$2',
      [ctx.org, id],
    )
  ).rows[0];
  if (!initial) throw new AccessError(404, 'NOT_FOUND');
  await lockVenues(db, ctx.org, [initial.venue_id, ...(extraVenue ? [extraVenue] : [])]);
  const row = (
    await db.query<Reservation>(
      'SELECT id,venue_id,sport_id,customer_id,status,start_at,end_at,price_cents::text,version,policy_version,recurrence_id FROM reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE',
      [ctx.org, id],
    )
  ).rows[0];
  if (!row) throw new AccessError(404, 'NOT_FOUND');
  if (row.venue_id !== initial.venue_id) fail(409, 'STALE_VERSION');
  return row;
}

export async function transitionReservation(
  db: PoolClient,
  ctx: BookingContext,
  id: string,
  action: 'confirm' | 'complete' | 'cancel' | 'no_show',
  expectedVersion: number,
  reason?: string,
  waiveFee = false,
) {
  const row = await lockReservation(db, ctx, id);
  if (row.version !== expectedVersion) fail(409, 'STALE_VERSION');
  const allowed =
    action === 'confirm'
      ? row.status === 'PENDING'
      : action === 'complete'
        ? row.status === 'CONFIRMED'
        : row.status === 'PENDING' || row.status === 'CONFIRMED';
  if (!allowed) fail(409, 'INVALID_TRANSITION');
  const at = new Date();
  if (action === 'cancel' && row.start_at <= at) fail(409, 'INVALID_TRANSITION');
  if (action === 'no_show' && row.start_at > at) fail(409, 'INVALID_TRANSITION');
  if (action === 'complete' && row.end_at > at) fail(409, 'INVALID_TRANSITION');
  const next = {
    confirm: 'CONFIRMED',
    complete: 'COMPLETED',
    cancel: 'CANCELLED',
    no_show: 'NO_SHOW',
  }[action];
  const fee =
    action === 'cancel'
      ? cancellationAmount(Number(row.price_cents), row.start_at, at)
      : action === 'no_show'
        ? noShowAmount(Number(row.price_cents))
        : 0;
  const effectiveFee = waiveFee ? 0 : fee;
  const leadSeconds = Math.trunc((row.start_at.getTime() - at.getTime()) / 1000);
  const policyPercent = action === 'cancel' ? (leadSeconds >= 86_400 ? 0 : 50) : 100;
  if (action === 'cancel' || action === 'no_show') {
    await db.query(
      'UPDATE schedule_occupancies SET active=false WHERE organization_id=$1 AND reservation_id=$2 AND active',
      [ctx.org, id],
    );
    await db.query(
      'INSERT INTO reservation_commercial_outcomes(organization_id,reservation_id,kind,policy_version,amount_cents,original_price_cents,policy_percent,lead_seconds,applied_exception,reason,waived_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        ctx.org,
        id,
        action === 'cancel' ? 'CANCELLATION' : 'NO_SHOW',
        row.policy_version,
        effectiveFee,
        row.price_cents,
        policyPercent,
        leadSeconds,
        waiveFee,
        reason ?? null,
        waiveFee ? ctx.actor : null,
      ],
    );
  }
  await db.query(
    `UPDATE reservations SET status=$3,version=version+1,updated_at=now(),
    confirmed_at=CASE WHEN $3='CONFIRMED' THEN now() ELSE confirmed_at END,
    cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,
    cancelled_by=CASE WHEN $3='CANCELLED' THEN $4::uuid ELSE cancelled_by END,
    cancellation_reason=CASE WHEN $3='CANCELLED' THEN $5::text ELSE cancellation_reason END,
    no_show_at=CASE WHEN $3='NO_SHOW' THEN now() ELSE no_show_at END
    WHERE organization_id=$1 AND id=$2`,
    [ctx.org, id, next, ctx.actor, reason ?? null],
  );
  await history(db, ctx, id, action, row.status, next, {
    feeCents: effectiveFee,
    waived: waiveFee,
  });
  await notifyAgenda(db, ctx.org, 'reservation.changed');
  return { id, status: next, version: row.version + 1, feeCents: effectiveFee };
}

export async function rescheduleReservation(
  db: PoolClient,
  ctx: BookingContext,
  id: string,
  input: Slot & { expectedVersion: number },
) {
  const row = await lockReservation(db, ctx, id, input.venueId);
  if (row.version !== input.expectedVersion) fail(409, 'STALE_VERSION');
  if (!['PENDING', 'CONFIRMED'].includes(row.status) || row.recurrence_id)
    fail(409, 'INVALID_TRANSITION');
  const slot = await inspectSlot(db, ctx.org, input);
  const occupied =
    (
      await db.query(
        "SELECT 1 FROM schedule_occupancies WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND active AND reservation_id IS DISTINCT FROM $3 AND period && tstzrange($4,$5,'[)') LIMIT 1",
        [ctx.org, slot.units, id, slot.startAt, slot.occupancyEnd],
      )
    ).rowCount !== 0;
  if (occupied) fail(409, 'SLOT_UNAVAILABLE');
  await db.query(
    'UPDATE schedule_occupancies SET active=false WHERE organization_id=$1 AND reservation_id=$2 AND active',
    [ctx.org, id],
  );
  await db.query(
    'UPDATE reservations SET venue_id=$3,sport_id=$4,start_at=$5,end_at=$6,price_cents=$7,price_source=$8,pricing_rule_id=$9,price_breakdown=$10,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',
    [
      ctx.org,
      id,
      input.venueId,
      input.sportId,
      slot.startAt,
      slot.endAt,
      slot.pricing!.totalCents,
      slot.pricing!.segments.some((s) => s.ruleId) ? 'RULE' : 'DEFAULT',
      slot.pricing!.segments.length === 1 ? slot.pricing!.segments[0]!.ruleId : null,
      JSON.stringify(slot.pricing!.segments),
    ],
  );
  await occupy(db, ctx, 'reservation', id, slot.units, slot.startAt, slot.occupancyEnd);
  const previous = Number(row.price_cents);
  if (previous !== slot.pricing!.totalCents)
    await db.query(
      'INSERT INTO reservation_commercial_outcomes(organization_id,reservation_id,kind,policy_version,amount_cents,previous_price_cents) VALUES($1,$2,$3,$4,$5,$6)',
      [ctx.org, id, 'RESCHEDULE', row.policy_version, slot.pricing!.totalCents, previous],
    );
  await history(db, ctx, id, 'rescheduled', row.status, row.status, {
    from: { venueId: row.venue_id, startAt: row.start_at, endAt: row.end_at, priceCents: previous },
    to: {
      venueId: input.venueId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      priceCents: slot.pricing!.totalCents,
    },
  });
  await notifyAgenda(db, ctx.org, 'reservation.changed');
  return { id, status: row.status, priceCents: slot.pricing!.totalCents, version: row.version + 1 };
}

export async function createBlock(
  db: PoolClient,
  ctx: BookingContext,
  input: Slot & { reason: string },
) {
  await lockVenues(db, ctx.org, [input.venueId]);
  const slot = await inspectSlot(db, ctx.org, input, false);
  if (slot.occupied) fail(409, 'SLOT_UNAVAILABLE');
  const row = (
    await db.query<{ id: string }>(
      'INSERT INTO venue_blocks(organization_id,venue_id,start_at,end_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [ctx.org, input.venueId, slot.startAt, slot.endAt, input.reason, ctx.actor],
    )
  ).rows[0]!;
  await occupy(db, ctx, 'block', row.id, slot.units, slot.startAt, slot.occupancyEnd);
  await notifyAgenda(db, ctx.org, 'block.changed');
  return row;
}

export async function idempotent<T>(
  db: PoolClient,
  ctx: BookingContext,
  key: string,
  method: string,
  route: string,
  payload: unknown,
  work: () => Promise<T>,
): Promise<T> {
  if (!/^[\x21-\x7e]{16,200}$/.test(key)) fail(400, 'VALIDATION_FAILED');
  const hash = createHash('sha256')
    .update(JSON.stringify({ method, route, payload }))
    .digest('hex');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    ctx.org + ':' + ctx.actor + ':' + key,
  ]);
  const previous = (
    await db.query<{ request_hash: string; response_body: T }>(
      'SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=$1 AND user_id=$2 AND key=$3 AND expires_at>now()',
      [ctx.org, ctx.actor, key],
    )
  ).rows[0];
  if (previous) {
    if (previous.request_hash !== hash) fail(409, 'IDEMPOTENCY_KEY_REUSED');
    return previous.response_body;
  }
  await db.query(
    'DELETE FROM idempotency_keys WHERE organization_id=$1 AND user_id=$2 AND key=$3 AND expires_at<=now()',
    [ctx.org, ctx.actor, key],
  );
  const result = await work();
  await db.query(
    'INSERT INTO idempotency_keys(organization_id,user_id,key,method,route,request_hash,response_status,response_body) VALUES($1,$2,$3,$4,$5,$6,200,$7)',
    [ctx.org, ctx.actor, key, method, route, hash, JSON.stringify(result)],
  );
  return result;
}
