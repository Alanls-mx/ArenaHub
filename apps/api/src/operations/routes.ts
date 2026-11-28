import {
  exceptionSchema,
  customerSchema,
  hoursSchema,
  linksSchema,
  pageSchema,
  pricingRuleSchema,
  quoteSchema,
  sportSchema,
  unitSchema,
  venueSchema,
  type Capability,
} from '@arenahub/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AccessError, audit, deny, transaction } from '../identity/core.js';
import { session, type IdentityOptions } from '../identity/session.js';
import { minute, overlap, quote, validateShifts, type PriceRule } from './rules.js';

type Context = { org: string; actor: string; log: (action: string, id: string) => Promise<void> };
const idOf = (r: FastifyRequest) => z.object({ id: z.uuid() }).parse(r.params).id;
const uniq = (values: string[]) => new Set(values).size === values.length;
const finiteCents = (v: unknown): number | null => (v == null ? null : Number(v));

export function operationalRoutes(app: FastifyInstance, pool: Pool, options: IdentityOptions) {
  function run<T>(
    r: FastifyRequest,
    cap: Capability,
    work: (db: PoolClient, c: Context) => Promise<T>,
  ) {
    return transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      const slug = z.object({ slug: z.string().max(80) }).parse(r.params).slug;
      const org = (
        await db.query<{ id: string }>(
          'SELECT id FROM organizations WHERE slug=$1 AND active ' +
            (r.method === 'GET' ? 'FOR SHARE' : 'FOR UPDATE'),
          [slug],
        )
      ).rows[0]?.id;
      if (!org || (options.hostOrganization?.(r) && options.hostOrganization?.(r) !== org))
        deny(404);
      const member = (
        await db.query<{ is_owner: boolean }>(
          "SELECT is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
          [org, s.user_id],
        )
      ).rows[0];
      if (!member) deny(404);
      if (
        !member.is_owner &&
        !(
          await db.query(
            'SELECT 1 FROM membership_roles mr JOIN role_permissions rp USING(organization_id,role_id) WHERE mr.organization_id=$1 AND mr.user_id=$2 AND rp.code=$3 LIMIT 1',
            [org, s.user_id, cap],
          )
        ).rowCount
      )
        deny(403);
      return work(db, {
        org,
        actor: s.user_id,
        log: (action, id) => audit(db, s.user_id, org, action, id, r.id),
      });
    });
  }
  const base = '/orgs/:slug';
  const list = (
    table: 'customers' | 'sports' | 'venues' | 'venue_units',
    cap: Capability,
    fields: string,
  ) =>
    app.get(base + '/' + (table === 'venue_units' ? 'units' : table), (r) =>
      run(r, cap, async (db, c) => {
        const p = pageSchema.parse(r.query);
        const byPhone = table === 'customers' ? 'AND ($6::text IS NULL OR phone_e164=$6)' : '';
        const rows = await db.query(
          `SELECT ${fields} FROM ${table} WHERE organization_id=$1 AND ($2::boolean OR archived_at IS NULL) AND ($3::text IS NULL OR name ILIKE '%'||$3||'%') AND ($4::uuid IS NULL OR id>$4) ${byPhone} ORDER BY id LIMIT $5`,
          [
            c.org,
            p.archived === 'true',
            p.q ?? null,
            p.cursor ?? null,
            p.limit + 1,
            ...(table === 'customers' ? [p.phone ?? null] : []),
          ],
        );
        return {
          items: rows.rows.slice(0, p.limit),
          nextCursor: rows.rows.length > p.limit ? rows.rows[p.limit - 1]?.id : null,
        };
      }),
    );
  list('customers', 'customers.read', 'id,name,phone_e164 AS phone,email,archived_at,created_at');
  list('sports', 'sports.read', 'id,name,archived_at');
  list('venue_units', 'venues.read', 'id,name,archived_at');
  app.get(base + '/venues', (r) =>
    run(r, 'venues.read', async (db, c) => {
      const p = pageSchema.parse(r.query);
      const rows = await db.query(
        `SELECT v.id,v.name,v.default_price_per_hour_cents,v.color,v.sort_order,v.archived_at,
        COALESCE((SELECT array_agg(sport_id) FROM venue_sports WHERE organization_id=$1 AND venue_id=v.id),'{}') AS sport_ids,
        COALESCE((SELECT array_agg(unit_id) FROM venue_unit_links WHERE organization_id=$1 AND venue_id=v.id),'{}') AS unit_ids,
        (SELECT count(*)::int FROM operating_hours h WHERE h.organization_id=$1 AND h.venue_id=v.id) AS hours_count
       FROM venues v WHERE v.organization_id=$1 AND ($2::boolean OR v.archived_at IS NULL)
       AND ($3::text IS NULL OR v.name ILIKE '%'||$3||'%')
       AND ($4::uuid IS NULL OR (v.sort_order,v.name,v.id) >
         (SELECT previous.sort_order,previous.name,previous.id FROM venues previous WHERE previous.organization_id=$1 AND previous.id=$4))
       ORDER BY v.sort_order,v.name,v.id LIMIT $5`,
        [c.org, p.archived === 'true', p.q ?? null, p.cursor ?? null, p.limit + 1],
      );
      return {
        items: rows.rows.slice(0, p.limit).map((x) => ({
          ...x,
          default_price_per_hour_cents: finiteCents(x.default_price_per_hour_cents),
        })),
        nextCursor: rows.rows.length > p.limit ? rows.rows[p.limit - 1]?.id : null,
      };
    }),
  );
  app.post(base + '/customers', (r) =>
    run(r, 'customers.manage', async (db, c) => {
      const x = customerSchema.parse(r.body);
      const row = (
        await db.query(
          'INSERT INTO customers(organization_id,name,phone_e164,email) VALUES($1,$2,$3,$4) RETURNING id',
          [c.org, x.name, x.phone, x.email],
        )
      ).rows[0];
      await c.log('customer.created', row.id);
      return row;
    }),
  );
  app.patch(base + '/customers/:id', (r) =>
    run(r, 'customers.manage', async (db, c) => {
      const x = customerSchema.parse(r.body),
        id = idOf(r);
      if (
        !(
          await db.query(
            'UPDATE customers SET name=$3,phone_e164=$4,email=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id, x.name, x.phone, x.email],
          )
        ).rowCount
      )
        deny(404);
      await c.log('customer.updated', id);
      return { ok: true };
    }),
  );
  app.delete(base + '/customers/:id', (r) =>
    run(r, 'customers.archive', async (db, c) => {
      const id = idOf(r);
      if (
        !(
          await db.query(
            'UPDATE customers SET archived_at=now() WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('customer.archived', id);
      return { ok: true };
    }),
  );
  app.post(base + '/sports', (r) =>
    run(r, 'sports.manage', async (db, c) => {
      const x = sportSchema.parse(r.body),
        row = (
          await db.query('INSERT INTO sports(organization_id,name) VALUES($1,$2) RETURNING id', [
            c.org,
            x.name,
          ])
        ).rows[0];
      await c.log('sport.created', row.id);
      return row;
    }),
  );
  app.patch(base + '/sports/:id', (r) =>
    run(r, 'sports.manage', async (db, c) => {
      const x = sportSchema.parse(r.body),
        id = idOf(r);
      if (
        !(
          await db.query(
            'UPDATE sports SET name=$3 WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id, x.name],
          )
        ).rowCount
      )
        deny(404);
      await c.log('sport.updated', id);
      return { ok: true };
    }),
  );
  app.delete(base + '/sports/:id', (r) =>
    run(r, 'sports.manage', async (db, c) => {
      const id = idOf(r);
      if (
        (
          await db.query(
            'SELECT 1 FROM venue_sports vs JOIN venues v ON v.organization_id=vs.organization_id AND v.id=vs.venue_id WHERE vs.organization_id=$1 AND vs.sport_id=$2 AND v.archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(409);
      if (
        !(
          await db.query(
            'UPDATE sports SET archived_at=now() WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('sport.archived', id);
      return { ok: true };
    }),
  );
  app.post(base + '/units', (r) =>
    run(r, 'units.manage', async (db, c) => {
      const x = unitSchema.parse(r.body),
        row = (
          await db.query(
            'INSERT INTO venue_units(organization_id,name) VALUES($1,$2) RETURNING id',
            [c.org, x.name],
          )
        ).rows[0];
      await c.log('unit.created', row.id);
      return row;
    }),
  );
  app.patch(base + '/units/:id', (r) =>
    run(r, 'units.manage', async (db, c) => {
      const x = unitSchema.parse(r.body),
        id = idOf(r);
      if (
        !(
          await db.query(
            'UPDATE venue_units SET name=$3 WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id, x.name],
          )
        ).rowCount
      )
        deny(404);
      await c.log('unit.updated', id);
      return { ok: true };
    }),
  );
  app.delete(base + '/units/:id', (r) =>
    run(r, 'units.manage', async (db, c) => {
      const id = idOf(r);
      if (
        (
          await db.query(
            'SELECT 1 FROM venue_unit_links l JOIN venues v ON v.organization_id=l.organization_id AND v.id=l.venue_id WHERE l.organization_id=$1 AND l.unit_id=$2 AND v.archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(409);
      if (
        !(
          await db.query(
            'UPDATE venue_units SET archived_at=now() WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('unit.archived', id);
      return { ok: true };
    }),
  );
  async function validRefs(
    db: PoolClient,
    c: Context,
    table: 'sports' | 'venue_units',
    ids: string[],
  ) {
    if (!uniq(ids)) deny(400);
    if (!ids.length) return;
    const rows = await db.query(
      `SELECT id FROM ${table} WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL FOR SHARE`,
      [c.org, ids],
    );
    if (rows.rowCount !== ids.length) deny(404);
  }
  app.post(base + '/venues', (r) =>
    run(r, 'venues.manage', async (db, c) => {
      const x = venueSchema.parse(r.body);
      await validRefs(db, c, 'sports', x.sportIds);
      if (x.unitIds) await validRefs(db, c, 'venue_units', x.unitIds);
      const row = (
        await db.query(
          'INSERT INTO venues(organization_id,name,default_price_per_hour_cents,color,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id',
          [c.org, x.name, x.defaultPricePerHourCents, x.color, x.sortOrder],
        )
      ).rows[0];
      let ids = x.unitIds;
      if (!ids) {
        const unit = (
          await db.query(
            'INSERT INTO venue_units(organization_id,name) VALUES($1,$2) RETURNING id',
            [c.org, x.name + ' · unidade'],
          )
        ).rows[0];
        ids = [unit.id];
      }
      if (!ids.length) deny(400);
      await db.query(
        'INSERT INTO venue_unit_links(organization_id,venue_id,unit_id) SELECT $1,$2,unnest($3::uuid[])',
        [c.org, row.id, ids],
      );
      await db.query(
        'INSERT INTO venue_sports(organization_id,venue_id,sport_id) SELECT $1,$2,unnest($3::uuid[])',
        [c.org, row.id, x.sportIds],
      );
      await c.log('venue.created', row.id);
      return row;
    }),
  );
  app.patch(base + '/venues/:id', (r) =>
    run(r, 'venues.manage', async (db, c) => {
      const x = venueSchema.parse(r.body),
        id = idOf(r);
      if (x.unitIds) deny(400);
      if (
        !(
          await db.query(
            'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await validRefs(db, c, 'sports', x.sportIds);
      if (
        (
          await db.query(
            'SELECT 1 FROM pricing_rules WHERE organization_id=$1 AND venue_id=$2 AND sport_id IS NOT NULL AND NOT (sport_id=ANY($3::uuid[])) AND archived_at IS NULL LIMIT 1',
            [c.org, id, x.sportIds],
          )
        ).rowCount
      )
        deny(409);
      await db.query(
        'UPDATE venues SET name=$3,default_price_per_hour_cents=$4,color=$5,sort_order=$6,updated_at=now() WHERE organization_id=$1 AND id=$2',
        [c.org, id, x.name, x.defaultPricePerHourCents, x.color, x.sortOrder],
      );
      await db.query('DELETE FROM venue_sports WHERE organization_id=$1 AND venue_id=$2', [
        c.org,
        id,
      ]);
      await db.query(
        'INSERT INTO venue_sports(organization_id,venue_id,sport_id) SELECT $1,$2,unnest($3::uuid[])',
        [c.org, id, x.sportIds],
      );
      await c.log('venue.updated', id);
      return { ok: true };
    }),
  );
  app.delete(base + '/venues/:id', (r) =>
    run(r, 'venues.manage', async (db, c) => {
      const id = idOf(r);
      if (
        !(
          await db.query(
            'UPDATE venues SET archived_at=now() WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('venue.archived', id);
      return { ok: true };
    }),
  );
  app.put(base + '/venues/:id/units', (r) =>
    run(r, 'units.manage', async (db, c) => {
      const id = idOf(r),
        x = linksSchema.parse(r.body);
      if (
        !(
          await db.query(
            'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await validRefs(db, c, 'venue_units', x.unitIds);
      await db.query('DELETE FROM venue_unit_links WHERE organization_id=$1 AND venue_id=$2', [
        c.org,
        id,
      ]);
      await db.query(
        'INSERT INTO venue_unit_links(organization_id,venue_id,unit_id) SELECT $1,$2,unnest($3::uuid[])',
        [c.org, id, x.unitIds],
      );
      await c.log('venue.composition.updated', id);
      return { ok: true };
    }),
  );
  app.get(base + '/venues/:id/operating-hours', (r) =>
    run(r, 'hours.read', async (db, c) => {
      const id = idOf(r);
      if (
        !(await db.query('SELECT 1 FROM venues WHERE organization_id=$1 AND id=$2', [c.org, id]))
          .rowCount
      )
        deny(404);
      return (
        await db.query(
          "SELECT id,weekday,to_char(open_time,'HH24:MI') AS open_time,to_char(close_time,'HH24:MI') AS close_time,spans_full_day FROM operating_hours WHERE organization_id=$1 AND venue_id=$2 ORDER BY weekday,open_time",
          [c.org, id],
        )
      ).rows;
    }),
  );
  app.put(base + '/venues/:id/operating-hours', (r) =>
    run(r, 'hours.manage', async (db, c) => {
      const id = idOf(r),
        x = hoursSchema.parse(r.body);
      if (
        !(
          await db.query(
            'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      try {
        validateShifts(x.shifts);
      } catch {
        deny(400);
      }
      await db.query('DELETE FROM operating_hours WHERE organization_id=$1 AND venue_id=$2', [
        c.org,
        id,
      ]);
      for (const s of x.shifts)
        await db.query(
          'INSERT INTO operating_hours(organization_id,venue_id,weekday,open_time,close_time,spans_full_day) VALUES($1,$2,$3,$4,$5,$6)',
          [c.org, id, s.weekday, s.openTime, s.closeTime, s.spansFullDay],
        );
      await c.log('venue.hours.updated', id);
      return { ok: true };
    }),
  );
  app.get(base + '/calendar-exceptions', (r) =>
    run(r, 'hours.read', async (db, c) => {
      const p = z.object({ venueId: z.uuid().optional() }).parse(r.query);
      return (
        await db.query(
          "SELECT id,venue_id,date::text,kind,to_char(open_time,'HH24:MI') AS open_time,to_char(close_time,'HH24:MI') AS close_time,description FROM calendar_exceptions WHERE organization_id=$1 AND ($2::uuid IS NULL OR venue_id=$2 OR venue_id IS NULL) ORDER BY date DESC LIMIT 200",
          [c.org, p.venueId ?? null],
        )
      ).rows;
    }),
  );
  app.post(base + '/calendar-exceptions', (r) =>
    run(r, 'hours.manage', async (db, c) => {
      const x = exceptionSchema.parse(r.body);
      if ((x.kind === 'CLOSED') !== (x.openTime === null && x.closeTime === null)) deny(400);
      if (
        x.venueId &&
        !(
          await db.query(
            'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
            [c.org, x.venueId],
          )
        ).rowCount
      )
        deny(404);
      const row = (
        await db.query(
          'INSERT INTO calendar_exceptions(organization_id,venue_id,date,kind,open_time,close_time,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [c.org, x.venueId, x.date, x.kind, x.openTime, x.closeTime, x.description],
        )
      ).rows[0];
      await c.log('calendar.exception.created', row.id);
      return row;
    }),
  );
  app.delete(base + '/calendar-exceptions/:id', (r) =>
    run(r, 'hours.manage', async (db, c) => {
      const id = idOf(r);
      if (
        !(
          await db.query('DELETE FROM calendar_exceptions WHERE organization_id=$1 AND id=$2', [
            c.org,
            id,
          ])
        ).rowCount
      )
        deny(404);
      await c.log('calendar.exception.deleted', id);
      return { ok: true };
    }),
  );
  app.get(base + '/pricing-rules', (r) =>
    run(r, 'pricing.read', async (db, c) => {
      const p = z.object({ venueId: z.uuid().optional() }).parse(r.query);
      return (
        await db.query(
          'SELECT id,venue_id,sport_id,specific_date::text,weekday,start_minute,end_minute,price_per_hour_cents::text,valid_from::text,valid_until::text,archived_at FROM pricing_rules WHERE organization_id=$1 AND ($2::uuid IS NULL OR venue_id=$2) ORDER BY created_at DESC LIMIT 200',
          [c.org, p.venueId ?? null],
        )
      ).rows.map((x) => ({ ...x, price_per_hour_cents: Number(x.price_per_hour_cents) }));
    }),
  );
  async function writeRule(
    db: PoolClient,
    c: Context,
    x: z.infer<typeof pricingRuleSchema>,
    id?: string,
  ) {
    if (
      (x.specificDate === null) === (x.weekday === null) ||
      (x.specificDate && (x.validFrom || x.validUntil)) ||
      (x.validFrom && x.validUntil && x.validFrom > x.validUntil)
    )
      deny(400);
    const start = minute(x.startTime),
      end = minute(x.endTime);
    if (start >= end) deny(400);
    if (
      !(
        await db.query(
          'SELECT id FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
          [c.org, x.venueId],
        )
      ).rowCount
    )
      deny(404);
    if (
      x.sportId &&
      !(
        await db.query(
          'SELECT 1 FROM venue_sports vs JOIN sports s ON s.organization_id=vs.organization_id AND s.id=vs.sport_id WHERE vs.organization_id=$1 AND vs.venue_id=$2 AND vs.sport_id=$3 AND s.archived_at IS NULL',
          [c.org, x.venueId, x.sportId],
        )
      ).rowCount
    )
      deny(404);
    const rows = (
      await db.query(
        'SELECT id,sport_id,specific_date::text,weekday,start_minute,end_minute,valid_from::text,valid_until::text FROM pricing_rules WHERE organization_id=$1 AND venue_id=$2 AND archived_at IS NULL AND ($3::uuid IS NULL OR id<>$3)',
        [c.org, x.venueId, id ?? null],
      )
    ).rows;
    const candidate = {
      sportId: x.sportId,
      specificDate: x.specificDate,
      weekday: x.weekday,
      startMinute: start,
      endMinute: end,
      validFrom: x.validFrom,
      validUntil: x.validUntil,
    };
    if (
      rows.some((b) =>
        overlap(candidate, {
          sportId: b.sport_id,
          specificDate: b.specific_date,
          weekday: b.weekday,
          startMinute: b.start_minute,
          endMinute: b.end_minute,
          validFrom: b.valid_from,
          validUntil: b.valid_until,
        }),
      )
    )
      throw new AccessError(409, 'PRICING_RULE_OVERLAP');
    const params = [
      c.org,
      x.venueId,
      x.sportId,
      x.specificDate,
      x.weekday,
      start,
      end,
      x.pricePerHourCents,
      x.validFrom,
      x.validUntil,
    ];
    if (id) {
      if (
        !(
          await db.query(
            'UPDATE pricing_rules SET sport_id=$3,specific_date=$4,weekday=$5,start_minute=$6,end_minute=$7,price_per_hour_cents=$8,valid_from=$9,valid_until=$10,updated_at=now() WHERE organization_id=$1 AND venue_id=$2 AND id=$11 AND archived_at IS NULL',
            [...params, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('pricing.rule.updated', id);
      return { id };
    }
    const row = (
      await db.query(
        'INSERT INTO pricing_rules(organization_id,venue_id,sport_id,specific_date,weekday,start_minute,end_minute,price_per_hour_cents,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        params,
      )
    ).rows[0];
    await c.log('pricing.rule.created', row.id);
    return row;
  }
  app.post(base + '/pricing-rules', (r) =>
    run(r, 'pricing.manage', (db, c) => writeRule(db, c, pricingRuleSchema.parse(r.body))),
  );
  app.patch(base + '/pricing-rules/:id', (r) =>
    run(r, 'pricing.manage', async (db, c) => {
      const id = idOf(r),
        old = (
          await db.query(
            'SELECT venue_id FROM pricing_rules WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rows[0];
      if (!old) deny(404);
      const x = pricingRuleSchema.parse(r.body);
      if (x.venueId !== old.venue_id) deny(400);
      return writeRule(db, c, x, id);
    }),
  );
  app.delete(base + '/pricing-rules/:id', (r) =>
    run(r, 'pricing.manage', async (db, c) => {
      const id = idOf(r),
        row = (
          await db.query(
            'SELECT venue_id FROM pricing_rules WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [c.org, id],
          )
        ).rows[0];
      if (!row) deny(404);
      await db.query('SELECT id FROM venues WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
        c.org,
        row.venue_id,
      ]);
      await db.query(
        'UPDATE pricing_rules SET archived_at=now() WHERE organization_id=$1 AND id=$2',
        [c.org, id],
      );
      await c.log('pricing.rule.archived', id);
      return { ok: true };
    }),
  );
  app.get(base + '/pricing/quote', (r) =>
    run(r, 'pricing.simulate', async (db, c) => {
      const x = quoteSchema.parse(r.query);
      const venue = (
        await db.query(
          'SELECT default_price_per_hour_cents FROM venues WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
          [c.org, x.venueId],
        )
      ).rows[0];
      if (!venue) deny(404);
      if (
        x.sportId &&
        !(
          await db.query(
            'SELECT 1 FROM venue_sports WHERE organization_id=$1 AND venue_id=$2 AND sport_id=$3',
            [c.org, x.venueId, x.sportId],
          )
        ).rowCount
      )
        deny(404);
      const rows = (
        await db.query(
          'SELECT id,sport_id,specific_date::text,weekday,start_minute,end_minute,price_per_hour_cents::text,valid_from::text,valid_until::text FROM pricing_rules WHERE organization_id=$1 AND venue_id=$2 AND archived_at IS NULL',
          [c.org, x.venueId],
        )
      ).rows;
      const rules: PriceRule[] = rows.map((v) => ({
        id: v.id,
        sportId: v.sport_id,
        specificDate: v.specific_date,
        weekday: v.weekday,
        startMinute: v.start_minute,
        endMinute: v.end_minute,
        pricePerHourCents: Number(v.price_per_hour_cents),
        validFrom: v.valid_from,
        validUntil: v.valid_until,
      }));
      return quote({
        date: x.date,
        startTime: x.startTime,
        durationMinutes: x.durationMinutes,
        sportId: x.sportId,
        defaultPricePerHourCents: finiteCents(venue.default_price_per_hour_cents),
        rules,
      });
    }),
  );
  app.get(base + '/domains', (r) =>
    run(
      r,
      'domains.manage',
      async (db, c) =>
        (
          await db.query(
            'SELECT id,hostname,kind,status,created_at,activated_at FROM organization_domains WHERE organization_id=$1 ORDER BY created_at DESC',
            [c.org],
          )
        ).rows,
    ),
  );
  app.post(base + '/domains/requests', (r) =>
    run(r, 'domains.manage', async (db, c) => {
      const x = z
        .strictObject({
          hostname: z
            .string()
            .trim()
            .toLowerCase()
            .max(253)
            .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/),
        })
        .parse(r.body);
      if (x.hostname.endsWith('.arenahub.com.br') || x.hostname === 'arenahub.com.br') deny(400);
      const row = (
        await db.query(
          "INSERT INTO organization_domains(organization_id,hostname,kind,status) VALUES($1,$2,'custom','pending') RETURNING id,hostname,status",
          [c.org, x.hostname],
        )
      ).rows[0];
      await c.log('domain.requested', row.id);
      return {
        ...row,
        notice:
          'Solicitação registrada. A verificação de DNS, TLS e autenticação ainda não está disponível.',
      };
    }),
  );
}
