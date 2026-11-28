import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import { AccessError, transaction } from '../identity/core.js';
import { inspectSlot, lockVenues, notifyAgenda } from './domain.js';

type Version = {
  id: string;
  organization_id: string;
  contract_id: string;
  venue_id: string;
  sport_id: string | null;
  customer_id: string;
  price_cents: string;
  starts_on: string;
  ends_on: string | null;
  generated_until: string | null;
  timezone: string;
};
type Rule = { weekday: number; start_time: string; duration_minutes: number };

async function markConflict(pool: Pool, version: Version, date: string, reason: string) {
  await transaction(pool, async (db) => {
    await db.query('SELECT id FROM organizations WHERE id=$1 AND active FOR SHARE', [
      version.organization_id,
    ]);
    await db.query(
      "INSERT INTO recurrence_exceptions(organization_id,recurrence_id,occurrence_date,kind,reason) VALUES($1,$2,$3,'CONFLICT',$4) ON CONFLICT(organization_id,recurrence_id,occurrence_date) DO NOTHING",
      [version.organization_id, version.id, date, reason],
    );
    await notifyAgenda(db, version.organization_id, 'recurrence.conflict');
  });
}

async function generateOne(pool: Pool, version: Version, rule: Rule, date: string) {
  try {
    return await transaction(pool, async (db) => {
      await db.query('SELECT id FROM organizations WHERE id=$1 AND active FOR SHARE', [
        version.organization_id,
      ]);
      await lockVenues(db, version.organization_id, [version.venue_id]);
      const active = (
        await db.query(
          "SELECT 1 FROM recurrences r JOIN recurrence_contracts c ON c.organization_id=r.organization_id AND c.id=r.contract_id WHERE r.organization_id=$1 AND r.id=$2 AND c.status='ACTIVE' AND r.starts_on<=$3::date AND (r.ends_on IS NULL OR r.ends_on>=$3::date)",
          [version.organization_id, version.id, date],
        )
      ).rowCount;
      if (!active) return 'skipped';
      if (
        (
          await db.query(
            'SELECT 1 FROM reservations WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date=$3 UNION ALL SELECT 1 FROM recurrence_exceptions WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date=$3 LIMIT 1',
            [version.organization_id, version.id, date],
          )
        ).rowCount
      )
        return 'existing';
      const slot = await inspectSlot(
        db,
        version.organization_id,
        {
          venueId: version.venue_id,
          sportId: version.sport_id,
          date,
          startTime: rule.start_time,
          durationMinutes: rule.duration_minutes,
        },
        false,
      );
      if (slot.occupied) throw new AccessError(409, 'SLOT_UNAVAILABLE');
      const reservation = (
        await db.query<{ id: string }>(
          `INSERT INTO reservations(organization_id,venue_id,sport_id,customer_id,recurrence_id,
         occurrence_date,start_at,end_at,status,source,price_cents,price_source,price_breakdown,
         policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CONFIRMED','RECURRENCE',$9,'RECURRENCE','[]',1)
         RETURNING id`,
          [
            version.organization_id,
            version.venue_id,
            version.sport_id,
            version.customer_id,
            version.id,
            date,
            slot.startAt,
            slot.endAt,
            version.price_cents,
          ],
        )
      ).rows[0]!;
      for (const unit of slot.units)
        await db.query(
          'INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
          [version.organization_id, unit, slot.startAt, slot.occupancyEnd, reservation.id],
        );
      await db.query(
        "INSERT INTO reservation_history(organization_id,reservation_id,action,to_status,changes) VALUES($1,$2,'generated','CONFIRMED',$3)",
        [
          version.organization_id,
          reservation.id,
          JSON.stringify({ recurrenceId: version.id, occurrenceDate: date }),
        ],
      );
      await notifyAgenda(db, version.organization_id, 'reservation.changed');
      return 'generated';
    });
  } catch (error) {
    if (
      error instanceof AccessError &&
      [
        'SLOT_UNAVAILABLE',
        'OUTSIDE_OPERATING_HOURS',
        'PRICE_UNAVAILABLE',
        'VENUE_UNITS_IN_USE',
      ].includes(error.code)
    ) {
      await markConflict(pool, version, date, error.code);
      return 'conflict';
    }
    if ((error as { code?: string })?.code === '23P01') {
      await markConflict(pool, version, date, 'SLOT_UNAVAILABLE');
      return 'conflict';
    }
    throw error;
  }
}

export async function generateRecurrences(pool: Pool, contractId?: string) {
  const versions = await transaction(
    pool,
    async (db) =>
      (
        await db.query<Version>(
          `SELECT r.id,r.organization_id,r.contract_id,r.venue_id,r.sport_id,c.customer_id,
     r.price_cents::text,r.starts_on::text,r.ends_on::text,r.generated_until::text,o.timezone
     FROM recurrences r JOIN recurrence_contracts c ON c.organization_id=r.organization_id AND c.id=r.contract_id
     JOIN organizations o ON o.id=r.organization_id
     WHERE c.status='ACTIVE' AND o.active
       AND ($1::uuid IS NULL OR c.id=$1)
     ORDER BY r.organization_id,r.id`,
          [contractId ?? null],
        )
      ).rows,
  );
  const totals = { generated: 0, conflict: 0, existing: 0 };
  for (const version of versions) {
    const today = Temporal.Now.zonedDateTimeISO(version.timezone).toPlainDate();
    if (
      version.ends_on &&
      Temporal.PlainDate.compare(Temporal.PlainDate.from(version.ends_on), today) < 0
    )
      continue;
    const horizon = today.add({ weeks: 10 });
    const start =
      Temporal.PlainDate.compare(Temporal.PlainDate.from(version.starts_on), today) > 0
        ? Temporal.PlainDate.from(version.starts_on)
        : today;
    const finish =
      version.ends_on &&
      Temporal.PlainDate.compare(Temporal.PlainDate.from(version.ends_on), horizon) < 0
        ? Temporal.PlainDate.from(version.ends_on)
        : horizon;
    const rules = await transaction(
      pool,
      async (db) =>
        (
          await db.query<Rule>(
            "SELECT weekday,to_char(start_time,'HH24:MI') AS start_time,duration_minutes FROM recurrence_rules WHERE organization_id=$1 AND recurrence_id=$2 ORDER BY weekday",
            [version.organization_id, version.id],
          )
        ).rows,
    );
    for (
      let day = start;
      Temporal.PlainDate.compare(day, finish) <= 0;
      day = day.add({ days: 1 })
    ) {
      const rule = rules.find((r) => r.weekday === day.dayOfWeek % 7);
      if (!rule) continue;
      const result = await generateOne(pool, version, rule, day.toString());
      if (result === 'generated' || result === 'conflict' || result === 'existing')
        totals[result]++;
    }
    if (Temporal.PlainDate.compare(start, finish) <= 0)
      await transaction(pool, async (db) => {
        await db.query(
          'UPDATE recurrences SET generated_until=GREATEST(COALESCE(generated_until,$3::date),$3::date) WHERE organization_id=$1 AND id=$2',
          [version.organization_id, version.id, finish.toString()],
        );
      });
  }
  return totals;
}
