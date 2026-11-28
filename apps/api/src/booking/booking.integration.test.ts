import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { requireDisposableDatabase } from '../__tests__/disposable-database.js';
import { buildApp } from '../app.js';
import { provision } from '../identity/provision.js';
import { recurrenceQueue, startWorker } from '../shared/jobs/index.js';
import { confirmFromValidatedPayment } from './financial-confirmation.js';
import { generateRecurrences } from './generate.js';

const origin = 'http://localhost:3000';
const slug = 'booking-' + randomUUID(),
  other = 'other-' + randomUUID();
const email = slug + '@example.org',
  password = randomUUID();
const date = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
let pool: Pool, app: FastifyInstance, org: string, alienOrg: string, databaseUrl: string;
let cookie: string, csrf: string, customer: string, sport: string;
let a: string, b: string, full: string, unitA: string, unitB: string;
let recurringContract: string, recurringVersion: string;
async function api(method: 'GET' | 'POST', path: string, body?: unknown, key?: string) {
  return app.inject({
    method,
    url: '/api/v1/orgs/' + slug + path,
    headers: { origin, cookie, 'x-csrf-token': csrf, ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { payload: body } : {}),
  });
}
const booking = (venueId: string, startTime = '18:00') => ({
  customerId: customer,
  venueId,
  sportId: sport,
  date,
  startTime,
  durationMinutes: 60,
  initialStatus: 'PENDING',
  source: 'IN_PERSON',
  notes: '',
});
beforeAll(async () => {
  const url = await requireDisposableDatabase();
  databaseUrl = url;
  pool = new Pool({ connectionString: url });
  await provision(pool, { slug, name: 'Reserva', ownerName: 'Owner', email, password });
  await provision(pool, { slug: other, name: 'Outra', ownerName: 'Owner', email, password });
  org = (await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [slug]))
    .rows[0].id;
  alienOrg = (
    await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [other])
  ).rows[0].id;
  app = buildApp({ databaseUrl: url, logLevel: 'silent', deliver: async () => {} });
  const logged = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  expect(logged.statusCode).toBe(200);
  cookie = String(logged.headers['set-cookie']).split(';')[0]!;
  csrf = (
    await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { origin, cookie } })
  ).json().csrf;
  customer = (
    await api('POST', '/customers', { name: 'Cliente de teste', phone: null, email: null })
  ).json().id;
  sport = (await api('POST', '/sports', { name: 'Futebol' })).json().id;
  unitA = (await api('POST', '/units', { name: 'Metade A' })).json().id;
  unitB = (await api('POST', '/units', { name: 'Metade B' })).json().id;
  const createVenue = async (name: string, unitIds: string[]) =>
    (
      await api('POST', '/venues', {
        name,
        unitIds,
        sportIds: [sport],
        defaultPricePerHourCents: 9000,
        color: null,
        sortOrder: 0,
      })
    ).json().id as string;
  a = await createVenue('Campo A', [unitA]);
  b = await createVenue('Campo B', [unitB]);
  full = await createVenue('Campo completo', [unitA, unitB]);
  for (const venue of [a, b, full]) {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/orgs/${slug}/venues/${venue}/operating-hours`,
          headers: { origin, cookie, 'x-csrf-token': csrf },
          payload: {
            shifts: [{ weekday, openTime: '06:00', closeTime: '23:00', spansFullDay: false }],
          },
        })
      ).statusCode,
    ).toBe(200);
  }
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('motor definitivo de reservas', () => {
  it('estima mensalidade antes de criar contrato, com o mesmo cálculo proporcional', async () => {
    const preview = await api(
      'GET',
      '/recurrence-contracts/first-month-preview?startsOn=2026-11-15&monthlyAmountCents=40000&weekdays=0,3',
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().firstMonthAmountCents).toBe(22222);
    expect(
      (
        await api(
          'GET',
          '/recurrence-contracts/first-month-preview?startsOn=2026-11-15&monthlyAmountCents=40000&weekdays=0,0',
        )
      ).statusCode,
    ).toBe(400);
  });
  it('ocupa todas as unidades, preserva pendente e responde replay da chave', async () => {
    const payload = booking(full);
    const key = randomUUID();
    const first = await api('POST', '/reservations', payload, key);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ status: 'PENDING', priceCents: 9000, version: 1 });
    const id = first.json().id;
    const replay = await api('POST', '/reservations', payload, key);
    expect(replay.json()).toEqual(first.json());
    expect(
      (await api('POST', '/reservations', { ...payload, notes: 'alterado' }, key)).statusCode,
    ).toBe(409);
    const occupancy = await pool.query(
      'SELECT unit_id FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
      [org, id],
    );
    expect(new Set(occupancy.rows.map((x) => x.unit_id))).toEqual(new Set([unitA, unitB]));
    const blocked = await api('POST', '/reservations', booking(a), randomUUID());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SLOT_UNAVAILABLE');
    const available = await api(
      'GET',
      `/availability?venueId=${a}&date=${date}&startTime=18%3A00&durationMinutes=60`,
    );
    expect(available.json().available).toBe(false);
    expect(
      (
        await api('POST', `/reservations/${id}/confirm`, { expectedVersion: 1 }, randomUUID())
      ).json(),
    ).toMatchObject({ status: 'CONFIRMED', version: 2 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
          [org, id],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (await api('POST', `/reservations/${id}/complete`, { expectedVersion: 2 }, randomUUID()))
        .statusCode,
    ).toBe(409);
    expect((await api('GET', `/reservations/${id}/cancellation-preview`)).json()).toMatchObject({
      originalPriceCents: 9000,
      policyPercent: 0,
      feeCents: 0,
      policyVersion: 1,
    });
    expect(
      (
        await api(
          'POST',
          `/reservations/${id}/cancel`,
          { expectedVersion: 2, reason: 'Cliente pediu', waiveFee: false },
          randomUUID(),
        )
      ).json(),
    ).toMatchObject({ status: 'CANCELLED', feeCents: 0 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
          [org, id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT original_price_cents::text,policy_percent,lead_seconds::text,applied_exception FROM arena_identity.reservation_commercial_outcomes WHERE organization_id=$1 AND reservation_id=$2 AND kind='CANCELLATION'",
          [org, id],
        )
      ).rows[0],
    ).toMatchObject({ original_price_cents: '9000', policy_percent: 0, applied_exception: false });
  });

  it('permite metades independentes e impede campo completo', async () => {
    const left = await api('POST', '/reservations', booking(a, '19:00'), randomUUID());
    const right = await api('POST', '/reservations', booking(b, '19:00'), randomUUID());
    expect(left.statusCode, left.body).toBe(200);
    expect(right.statusCode, right.body).toBe(200);
    expect(
      (await api('POST', '/reservations', booking(full, '19:00'), randomUUID())).statusCode,
    ).toBe(409);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND start_at::date=$2::date AND active',
          [org, date],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it('registra no-show identificado sem duplicar obrigação ou apagar histórico', async () => {
    const start = new Date(Date.now() - 2 * 3600_000);
    const end = new Date(Date.now() - 3600_000);
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO arena_identity.reservations(organization_id,venue_id,customer_id,start_at,end_at,status,source,price_cents,price_source) VALUES($1,$2,$3,$4,$5,'CONFIRMED','ADMIN',9000,'DEFAULT') RETURNING id",
        [org, a, customer, start, end],
      )
    ).rows[0]!.id;
    await pool.query(
      'INSERT INTO arena_identity.schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
      [org, unitA, start, end, id],
    );
    const key = randomUUID();
    const result = await api('POST', `/reservations/${id}/no_show`, { expectedVersion: 1 }, key);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ status: 'NO_SHOW', feeCents: 9000, version: 2 });
    expect(
      (await api('POST', `/reservations/${id}/no_show`, { expectedVersion: 1 }, key)).json(),
    ).toEqual(result.json());
    expect(
      (
        await pool.query(
          "SELECT original_price_cents::text,policy_percent,amount_cents::text FROM arena_identity.reservation_commercial_outcomes WHERE organization_id=$1 AND reservation_id=$2 AND kind='NO_SHOW'",
          [org, id],
        )
      ).rows[0],
    ).toMatchObject({ original_price_cents: '9000', policy_percent: 100, amount_cents: '9000' });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
          [org, id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('serializa criação concorrente com a mesma chave sem duplicar histórico', async () => {
    const key = randomUUID();
    const payload = booking(b, '16:00');
    const [first, second] = await Promise.all([
      api('POST', '/reservations', payload, key),
      api('POST', '/reservations', payload, key),
    ]);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.reservation_history WHERE organization_id=$1 AND reservation_id=$2',
          [org, first.json().id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('serializa reserva avulsa e bloqueio simultâneos na mesma unidade', async () => {
    const [reservation, block] = await Promise.all([
      api('POST', '/reservations', booking(b, '09:00'), randomUUID()),
      api(
        'POST',
        '/blocks',
        { venueId: b, date, startTime: '09:00', durationMinutes: 60, reason: 'Manutenção' },
        randomUUID(),
      ),
    ]);
    expect([reservation.statusCode, block.statusCode].sort()).toEqual([200, 409]);
    const start = new Date(date + 'T12:00:00Z');
    const active = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND unit_id=$2 AND active AND period @> $3::timestamptz',
      [org, unitB, start],
    );
    expect(active.rows[0]!.n).toBe(1);
  });

  it('rejeita referência a cliente de outra arena e filtra a agenda', async () => {
    const foreign = (
      await pool.query(
        'INSERT INTO arena_identity.customers(organization_id,name) VALUES($1,$2) RETURNING id',
        [alienOrg, 'Outro cliente'],
      )
    ).rows[0].id;
    expect(
      (
        await api(
          'POST',
          '/reservations',
          { ...booking(a, '20:00'), customerId: foreign },
          randomUUID(),
        )
      ).statusCode,
    ).toBe(404);
    const agenda = await api('GET', `/agenda?from=${date}&to=${date}`);
    expect(agenda.statusCode).toBe(200);
    expect(
      agenda.json().reservations.every((x: { customer_id: string }) => x.customer_id !== foreign),
    ).toBe(true);
    const own = await api('POST', '/reservations', booking(b, '15:00'), randomUUID());
    expect(own.statusCode).toBe(200);
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${other}/reservations/${own.json().id}`,
      headers: { origin, cookie },
    });
    expect(foreignRead.statusCode).toBe(404);
  });
  it('preserva horário e ocupação quando a remarcação falha; bloqueios respeitam a mesma disputa', async () => {
    const original = await api('POST', '/reservations', booking(a, '14:00'), randomUUID());
    expect(original.statusCode, original.body).toBe(200);
    const id = original.json().id;
    const before = (await api('GET', `/reservations/${id}`)).json();
    const preview = await api(
      'GET',
      `/reservations/${id}/reschedule-preview?venueId=${full}&sportId=${sport}&date=${date}&startTime=19%3A00&durationMinutes=60&expectedVersion=1`,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      available: false,
      oldPriceCents: 9000,
      newPriceCents: 9000,
    });
    const failed = await api(
      'POST',
      `/reservations/${id}/reschedule`,
      {
        venueId: full,
        sportId: sport,
        date,
        startTime: '19:00',
        durationMinutes: 60,
        expectedVersion: 1,
      },
      randomUUID(),
    );
    expect(failed.statusCode).toBe(409);
    expect(failed.json().code).toBe('SLOT_UNAVAILABLE');
    const after = (await api('GET', `/reservations/${id}`)).json();
    expect(after).toMatchObject({ version: 1, start_at: before.start_at, venue_id: a });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
          [org, id],
        )
      ).rows[0].n,
    ).toBe(1);
    const block = await api(
      'POST',
      '/blocks',
      {
        venueId: full,
        date,
        startTime: '14:00',
        durationMinutes: 60,
        reason: 'Manutenção',
      },
      randomUUID(),
    );
    expect(block.statusCode).toBe(409);
    expect(
      (
        await api(
          'POST',
          `/reservations/${id}/cancel`,
          {
            expectedVersion: 1,
            reason: 'Teste de liberação',
            waiveFee: false,
          },
          randomUUID(),
        )
      ).statusCode,
    ).toBe(200);
    const released = await api(
      'POST',
      '/blocks',
      {
        venueId: full,
        date,
        startTime: '14:00',
        durationMinutes: 60,
        reason: 'Manutenção',
      },
      randomUUID(),
    );
    expect(released.statusCode, released.body).toBe(200);
    const listed = await api('GET', `/blocks?from=${date}&to=${date}`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().some((x: { id: string }) => x.id === released.json().id)).toBe(true);
    expect((await api('POST', '/reservations', booking(a, '14:00'), randomUUID())).statusCode).toBe(
      409,
    );
  });
  it('materializa recorrência válida e registra conflito isolado sem duplicar', async () => {
    const until = new Date(new Date(date + 'T12:00:00Z').getTime() + 14 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const create = await api(
      'POST',
      '/recurrence-contracts',
      {
        customerId: customer,
        venueId: a,
        sportId: sport,
        billingMode: 'MONTHLY',
        startsOn: date,
        endsOn: until,
        priceCents: 9000,
        monthlyAmountCents: 24000,
        rules: [{ weekday, startTime: '19:00', durationMinutes: 60 }],
      },
      randomUUID(),
    );
    expect(create.statusCode, create.body).toBe(200);
    const { id, recurrenceId } = create.json();
    recurringContract = id;
    recurringVersion = recurrenceId;
    const listed = await api('GET', '/recurrence-contracts?search=Cliente');
    expect(listed.statusCode).toBe(200);
    expect(listed.json().find((x: { id: string }) => x.id === id)).toMatchObject({
      customer_name: 'Cliente de teste',
      venue_name: 'Campo A',
      conflict_count: 1,
    });
    expect(
      (await api('GET', `/recurrence-contracts/${id}/history`))
        .json()
        .some((x: { action: string }) => x.action === 'recurrence.contract.created'),
    ).toBe(true);
    const exceptions = await pool.query(
      'SELECT occurrence_date::text,kind FROM arena_identity.recurrence_exceptions WHERE organization_id=$1 AND recurrence_id=$2',
      [org, recurrenceId],
    );
    expect(exceptions.rows).toEqual([{ occurrence_date: date, kind: 'CONFLICT' }]);
    const before = (
      await pool.query(
        'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2',
        [org, recurrenceId],
      )
    ).rows[0].n;
    expect(before).toBe(1); // the third week lies outside the ten-week horizon
    expect((await generateRecurrences(pool, id)).generated).toBe(0);
    const after = (
      await pool.query(
        'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2',
        [org, recurrenceId],
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });
  it('serializa recorrência e reserva avulsa concorrentes na mesma unidade física', async () => {
    const contractId = (
      await pool.query<{ id: string }>(
        "INSERT INTO arena_identity.recurrence_contracts(organization_id,customer_id,billing_mode) VALUES($1,$2,'PER_OCCURRENCE') RETURNING id",
        [org, customer],
      )
    ).rows[0]!.id;
    const recurrenceId = (
      await pool.query<{ id: string }>(
        `INSERT INTO arena_identity.recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
        duration_minutes,starts_on,ends_on,effective_from,price_cents)
        VALUES($1,$2,$3,$4,$5,'17:00',60,$6,$6,$6,9000) RETURNING id`,
        [org, contractId, full, sport, weekday, date],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO arena_identity.recurrence_rules(organization_id,recurrence_id,weekday,start_time,duration_minutes) VALUES($1,$2,$3,'17:00',60)",
      [org, recurrenceId, weekday],
    );
    const [generated, single] = await Promise.all([
      generateRecurrences(pool, contractId),
      api('POST', '/reservations', booking(full, '17:00'), randomUUID()),
    ]);
    expect([200, 409]).toContain(single.statusCode);
    expect(generated.generated + generated.conflict).toBe(1);
    expect(generated.generated === 1).toBe(single.statusCode === 409);
    const rows = await pool.query<{ id: string; recurrence_id: string | null }>(
      `SELECT id,recurrence_id FROM arena_identity.reservations
       WHERE organization_id=$1 AND venue_id=$2 AND start_at=(SELECT start_at FROM arena_identity.reservations
         WHERE organization_id=$1 AND venue_id=$2 AND
           ((recurrence_id=$3) OR (id=$4::uuid)) LIMIT 1)
         AND status IN ('PENDING','CONFIRMED')`,
      [org, full, recurrenceId, single.statusCode === 200 ? single.json().id : null],
    );
    expect(rows.rows).toHaveLength(1);
    expect(
      (
        await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies
           WHERE organization_id=$1 AND reservation_id=$2 AND active`,
          [org, rows.rows[0]!.id],
        )
      ).rows[0]!.n,
    ).toBe(2);
    expect((await generateRecurrences(pool, contractId)).generated).toBe(0);
  });
  it('serializa mudança de composição física e criação de reserva', async () => {
    const beforeUnit = (await api('POST', '/units', { name: 'Unidade anterior' })).json().id;
    const afterUnit = (await api('POST', '/units', { name: 'Unidade proposta' })).json().id;
    const venueId = (
      await api('POST', '/venues', {
        name: 'Venue concorrente',
        unitIds: [beforeUnit],
        sportIds: [sport],
        defaultPricePerHourCents: 9000,
        color: null,
        sortOrder: 0,
      })
    ).json().id;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/orgs/${slug}/venues/${venueId}/operating-hours`,
          headers: { origin, cookie, 'x-csrf-token': csrf },
          payload: {
            shifts: [{ weekday, openTime: '06:00', closeTime: '23:00', spansFullDay: false }],
          },
        })
      ).statusCode,
    ).toBe(200);
    const [reservation, composition] = await Promise.all([
      api('POST', '/reservations', booking(venueId, '10:00'), randomUUID()),
      app.inject({
        method: 'PUT',
        url: `/api/v1/orgs/${slug}/venues/${venueId}/units`,
        headers: { origin, cookie, 'x-csrf-token': csrf },
        payload: { unitIds: [afterUnit] },
      }),
    ]);
    expect(reservation.statusCode, reservation.body).toBe(200);
    expect([200, 409]).toContain(composition.statusCode);
    const occupied = (
      await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM arena_identity.schedule_occupancies WHERE organization_id=$1 AND reservation_id=$2 AND active',
        [org, reservation.json().id],
      )
    ).rows;
    expect(occupied).toHaveLength(1);
    const linked = (
      await pool.query<{ unit_id: string }>(
        'SELECT unit_id FROM arena_identity.venue_unit_links WHERE organization_id=$1 AND venue_id=$2',
        [org, venueId],
      )
    ).rows;
    expect(linked).toHaveLength(1);
    expect(occupied[0]!.unit_id).toBe(linked[0]!.unit_id);
    expect(composition.statusCode === 200 ? afterUnit : beforeUnit).toBe(linked[0]!.unit_id);
  });
  it('transmite invalidação pelo WebSocket real somente após commit', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const endpoint = new URL(address);
    endpoint.hostname = 'localhost';
    endpoint.protocol = 'ws:';
    const stream = new WebSocket(
      endpoint.toString().replace(/\/$/, '') + `/api/v1/orgs/${slug}/agenda/stream`,
      { headers: { origin, cookie } },
    );
    try {
      const connected = await new Promise<string>((resolve, reject) => {
        stream.once('message', (data) => resolve(data.toString()));
        stream.once('error', reject);
      });
      expect(JSON.parse(connected).type).toBe('agenda.connected');
      const event = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('WebSocket não recebeu commit')), 5000);
        stream.once('message', (data) => {
          clearTimeout(timer);
          resolve(data.toString());
        });
      });
      const created = await api('POST', '/reservations', booking(a, '21:00'), randomUUID());
      expect(created.statusCode, created.body).toBe(200);
      expect(JSON.parse(await event)).toEqual({
        type: 'agenda.invalidate',
        kind: 'reservation.changed',
      });
      let rollbackEvent = false;
      const observe = () => {
        rollbackEvent = true;
      };
      stream.on('message', observe);
      const failed = await api('POST', '/reservations', booking(a, '21:00'), randomUUID());
      expect(failed.statusCode).toBe(409);
      await new Promise((resolve) => setTimeout(resolve, 200));
      stream.off('message', observe);
      expect(rollbackEvent).toBe(false);
    } finally {
      stream.close();
    }
  });
  it('recusa WebSocket sem sessão ou com Origin indevida', async () => {
    const port = (app.server.address() as AddressInfo).port;
    const url = `ws://localhost:${port}/api/v1/orgs/${slug}/agenda/stream`;
    const rejected = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(url, { headers });
        ws.once('unexpected-response', (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        ws.once('open', () => {
          ws.close();
          reject(Error('Canal indevido foi aberto'));
        });
        ws.once('error', reject);
      });
    expect(await rejected({ origin })).toBe(401);
    expect(await rejected({ origin: 'https://evil.example', cookie })).toBe(403);
  });
  it('faz o PostgreSQL arbitrar escritores independentes e respeita o limite semiaberto', async () => {
    const c1 = await pool.connect(),
      c2 = await pool.connect();
    const start = new Date(date + 'T08:00:00Z'),
      end = new Date(date + 'T09:00:00Z');
    const insertReservation = async (db: typeof c1) => {
      await db.query('BEGIN');
      await db.query('SET LOCAL search_path TO arena_identity,pg_catalog');
      return (
        await db.query<{ id: string }>(
          `INSERT INTO reservations(organization_id,venue_id,customer_id,start_at,end_at,status,source,
         price_cents,price_source) VALUES($1,$2,$3,$4,$5,'PENDING','ADMIN',9000,'DEFAULT') RETURNING id`,
          [org, a, customer, start, end],
        )
      ).rows[0]!.id;
    };
    try {
      const first = await insertReservation(c1),
        second = await insertReservation(c2);
      await c1.query(
        'INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
        [org, unitA, start, end, first],
      );
      const secondPid = (await c2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      const conflict = c2.query(
        'INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
        [org, unitA, start, end, second],
      );
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        waiting =
          (
            await pool.query<{ wait_event_type: string | null }>(
              'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
              [secondPid],
            )
          ).rows[0]?.wait_event_type === 'Lock';
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      await c1.query('COMMIT');
      await expect(conflict).rejects.toMatchObject({ code: '23P01' });
      await c2.query('ROLLBACK');
      const adjacent = await insertReservation(c2);
      await c2.query(
        'UPDATE reservations SET start_at=$3,end_at=$4 WHERE organization_id=$1 AND id=$2',
        [org, adjacent, end, new Date(date + 'T10:00:00Z')],
      );
      await c2.query(
        'INSERT INTO schedule_occupancies(organization_id,unit_id,start_at,end_at,reservation_id) VALUES($1,$2,$3,$4,$5)',
        [org, unitA, end, new Date(date + 'T10:00:00Z'), adjacent],
      );
      await c2.query('COMMIT');
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await c2.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
    }
  });
  it('resolve conflito recorrente e preserva identidade do contrato entre versões', async () => {
    const conflict = (
      await pool.query<{ id: string }>(
        "SELECT id FROM arena_identity.recurrence_exceptions WHERE organization_id=$1 AND recurrence_id=$2 AND kind='CONFLICT'",
        [org, recurringVersion],
      )
    ).rows[0]!.id;
    const moved = await api(
      'POST',
      `/recurrence-conflicts/${conflict}/resolve`,
      {
        action: 'MOVE',
        date,
        startTime: '20:00',
        durationMinutes: 60,
        reason: 'Horário alternativo',
      },
      randomUUID(),
    );
    expect(moved.statusCode, moved.body).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT kind FROM arena_identity.recurrence_exceptions WHERE organization_id=$1 AND id=$2',
          [org, conflict],
        )
      ).rows[0].kind,
    ).toBe('MOVED');
    const effective = new Date(new Date(date + 'T12:00:00Z').getTime() + 7 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const until = new Date(new Date(date + 'T12:00:00Z').getTime() + 14 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const version = await api(
      'POST',
      `/recurrence-contracts/${recurringContract}/versions`,
      {
        venueId: a,
        sportId: sport,
        effectiveFrom: effective,
        endsOn: until,
        priceCents: 10000,
        monthlyAmountCents: 30000,
        rules: [{ weekday, startTime: '20:00', durationMinutes: 60 }],
      },
      randomUUID(),
    );
    expect(version.statusCode, version.body).toBe(200);
    expect(version.json().id).toBe(recurringContract);
    expect(version.json().cancelledFuture).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT status FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date=$3',
          [org, recurringVersion, effective],
        )
      ).rows[0].status,
    ).toBe('CANCELLED');
    expect(
      (await api('POST', `/recurrence-contracts/${recurringContract}/end`, {}, randomUUID())).json()
        .code,
    ).toBe('RECURRENCE_REQUIRES_RESOLUTION');
    const movedReservation = (
      await pool.query<{ id: string }>(
        'SELECT reservation_id AS id FROM arena_identity.recurrence_exceptions WHERE organization_id=$1 AND id=$2',
        [org, conflict],
      )
    ).rows[0]!.id;
    expect(
      (
        await api(
          'POST',
          `/reservations/${movedReservation}/cancel`,
          { expectedVersion: 1, reason: 'Encerramento autorizado', waiveFee: false },
          randomUUID(),
        )
      ).statusCode,
    ).toBe(200);
    const ended = await api(
      'POST',
      `/recurrence-contracts/${recurringContract}/end`,
      {},
      randomUUID(),
    );
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json().status).toBe('ENDED');
  });
  it('confirma por evidência financeira interna sem registrar pagamento fictício', async () => {
    const created = await api('POST', '/reservations', booking(b, '22:00'), randomUUID());
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().id,
      reference = randomUUID();
    const proof = {
      organizationId: org,
      reservationId: id,
      customerId: customer,
      externalPaymentRef: reference,
      approvedAmountCents: 9000,
      approvedAt: new Date(),
      status: 'APPROVED' as const,
    };
    const confirmed = await confirmFromValidatedPayment(pool, proof);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', version: 2, replay: false });
    expect(await confirmFromValidatedPayment(pool, proof)).toMatchObject({
      replay: true,
      version: 2,
    });
    await expect(
      confirmFromValidatedPayment(pool, {
        ...proof,
        approvedAmountCents: 9001,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.reservation_payment_confirmations WHERE organization_id=$1 AND reservation_id=$2',
          [org, id],
        )
      ).rows[0].n,
    ).toBe(1);
    const second = await api('POST', '/reservations', booking(b, '12:00'), randomUUID());
    expect(second.statusCode).toBe(200);
    await expect(
      confirmFromValidatedPayment(pool, {
        ...proof,
        reservationId: second.json().id,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      confirmFromValidatedPayment(pool, {
        ...proof,
        reservationId: second.json().id,
        externalPaymentRef: randomUUID(),
        approvedAmountCents: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await api('GET', `/reservations/${second.json().id}`)).json().status).toBe('PENDING');
    expect(
      (
        await api(
          'POST',
          `/reservations/${id}/cancel`,
          {
            expectedVersion: 2,
            reason: 'Cancelamento posterior',
            waiveFee: false,
          },
          randomUUID(),
        )
      ).statusCode,
    ).toBe(200);
    expect(await confirmFromValidatedPayment(pool, proof)).toMatchObject({
      status: 'CANCELLED',
      replay: true,
    });
  });
  it('aplica RBAC e encerra o WebSocket quando a membership é revogada', async () => {
    const staffEmail = 'staff-' + randomUUID() + '@example.org';
    await provision(pool, {
      slug: 'staff-' + randomUUID(),
      name: 'Staff home',
      ownerName: 'Staff',
      email: staffEmail,
      password,
    });
    const userId = (
      await pool.query<{ id: string }>('SELECT id FROM arena_identity.users WHERE email=$1', [
        staffEmail,
      ])
    ).rows[0]!.id;
    const staffRole = (
      await pool.query<{ id: string }>(
        "SELECT id FROM arena_identity.roles WHERE organization_id=$1 AND name='Staff'",
        [org],
      )
    ).rows[0]!.id;
    await pool.query(
      'INSERT INTO arena_identity.memberships(organization_id,user_id) VALUES($1,$2)',
      [org, userId],
    );
    await pool.query(
      'INSERT INTO arena_identity.membership_roles(organization_id,user_id,role_id) VALUES($1,$2,$3)',
      [org, userId, staffRole],
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: staffEmail, password },
    });
    expect(login.statusCode).toBe(200);
    const staffCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const staffCsrf = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { origin, cookie: staffCookie },
      })
    ).json().csrf;
    const staffRequest = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
      app.inject({
        method,
        url: `/api/v1/orgs/${slug}${path}`,
        headers: {
          origin,
          cookie: staffCookie,
          'x-csrf-token': staffCsrf,
          'idempotency-key': randomUUID(),
        },
        ...(payload ? { payload } : {}),
      });
    expect((await staffRequest('GET', `/agenda?from=${date}&to=${date}`)).statusCode).toBe(200);
    expect(
      (
        await staffRequest('POST', '/blocks', {
          venueId: b,
          date,
          startTime: '13:00',
          durationMinutes: 60,
          reason: 'Teste',
        })
      ).statusCode,
    ).toBe(403);
    const owned = await staffRequest('POST', '/reservations', booking(b, '13:00'));
    expect(owned.statusCode, owned.body).toBe(200);
    expect(
      (
        await staffRequest('POST', `/reservations/${owned.json().id}/cancel`, {
          expectedVersion: 1,
          reason: 'Isenção',
          waiveFee: true,
        })
      ).statusCode,
    ).toBe(403);
    const addr = app.server.address() as AddressInfo;
    const stream = new WebSocket(`ws://localhost:${addr.port}/api/v1/orgs/${slug}/agenda/stream`, {
      headers: { origin, cookie: staffCookie },
    });
    try {
      const connected = new Promise<string>((resolve, reject) => {
        stream.once('message', (data) => resolve(data.toString()));
        stream.once('error', reject);
      });
      expect(JSON.parse(await connected).type).toBe('agenda.connected');
      const closed = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error('WebSocket não encerrou após revogação')),
          5000,
        );
        stream.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      await pool.query(
        "UPDATE arena_identity.memberships SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
        [org, userId],
      );
      expect((await staffRequest('GET', `/agenda?from=${date}&to=${date}`)).statusCode).toBe(404);
      const trigger = await api('POST', '/reservations', booking(a, '12:00'), randomUUID());
      expect(trigger.statusCode, trigger.body).toBe(200);
      expect(await closed).toBe(1008);
    } finally {
      stream.close();
    }
  });
  it('retoma o listener PostgreSQL e mantém uma única conexão LISTEN', async () => {
    const address = app.server.address() as AddressInfo;
    const stream = new WebSocket(
      `ws://localhost:${address.port}/api/v1/orgs/${slug}/agenda/stream`,
      { headers: { origin, cookie } },
    );
    const nextEvent = () =>
      new Promise<{ type: string; kind?: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Evento de agenda não chegou')), 8000);
        stream.once('message', (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(data.toString()));
        });
        stream.once('error', reject);
      });
    try {
      expect((await nextEvent()).type).toBe('agenda.connected');
      const listener = await pool.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE application_name='arenahub-agenda-listener' AND state='idle'",
      );
      expect(listener.rows).toHaveLength(1);
      const resumed = nextEvent();
      await pool.query('SELECT pg_terminate_backend($1)', [listener.rows[0]!.pid]);
      expect(await resumed).toEqual({ type: 'agenda.invalidate', kind: 'listener.reconnected' });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='arenahub-agenda-listener'",
          )
        ).rows[0].n,
      ).toBe(1);
      const changed = nextEvent();
      await pool.query('SELECT pg_notify($1,$2)', [
        'arenahub_agenda',
        JSON.stringify({ org, kind: 'reservation.changed' }),
      ]);
      expect(await changed).toEqual({ type: 'agenda.invalidate', kind: 'reservation.changed' });
    } finally {
      stream.close();
    }
  });
  it('fecha a conexão quando a sessão é revogada e rejeita mensagens do cliente', async () => {
    const logged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    expect(logged.statusCode).toBe(200);
    const freshCookie = String(logged.headers['set-cookie']).split(';')[0]!;
    const freshCsrf = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { origin, cookie: freshCookie },
      })
    ).json().csrf;
    const url = `ws://localhost:${(app.server.address() as AddressInfo).port}/api/v1/orgs/${slug}/agenda/stream`;
    const stream = new WebSocket(url, { headers: { origin, cookie: freshCookie } });
    try {
      const connected = new Promise<string>((resolve, reject) => {
        stream.once('message', (data) => resolve(data.toString()));
        stream.once('error', reject);
      });
      expect(JSON.parse(await connected).type).toBe('agenda.connected');
      const closed = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Sessão revogada continuou conectada')), 5000);
        stream.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      const logout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { origin, cookie: freshCookie, 'x-csrf-token': freshCsrf },
      });
      expect(logout.statusCode).toBe(200);
      await pool.query('SELECT pg_notify($1,$2)', [
        'arenahub_agenda',
        JSON.stringify({ org, kind: 'reservation.changed' }),
      ]);
      expect(await closed).toBe(1008);
    } finally {
      stream.close();
    }
    const invalid = new WebSocket(url, { headers: { origin, cookie } });
    try {
      const connected = new Promise<string>((resolve, reject) => {
        invalid.once('message', (data) => resolve(data.toString()));
        invalid.once('error', reject);
      });
      expect(JSON.parse(await connected).type).toBe('agenda.connected');
      const closed = new Promise<number>((resolve, reject) => {
        invalid.once('close', (code) => resolve(code));
        invalid.once('error', reject);
      });
      invalid.send('client payload forbidden');
      expect(await closed).toBe(1008);
    } finally {
      invalid.close();
    }
  });
  it('worker real materializa a ocorrência e reprocessa sem duplicação', async () => {
    const nextDate = new Date(new Date(date + 'T12:00:00Z').getTime() + 7 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const contractId = (
      await pool.query<{ id: string }>(
        "INSERT INTO arena_identity.recurrence_contracts(organization_id,customer_id,billing_mode) VALUES($1,$2,'PER_OCCURRENCE') RETURNING id",
        [org, customer],
      )
    ).rows[0]!.id;
    const versionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO arena_identity.recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
       duration_minutes,starts_on,ends_on,effective_from,price_cents)
       VALUES($1,$2,$3,$4,$5,'11:00',60,$6,$6,$6,9000) RETURNING id`,
        [org, contractId, b, sport, weekday, nextDate],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO arena_identity.recurrence_rules(organization_id,recurrence_id,weekday,start_time,duration_minutes) VALUES($1,$2,$3,'11:00',60)",
      [org, versionId, weekday],
    );
    const port = (app.server.address() as AddressInfo).port;
    const stream = new WebSocket(`ws://localhost:${port}/api/v1/orgs/${slug}/agenda/stream`, {
      headers: { origin, cookie },
    });
    const connected = new Promise<string>((resolve, reject) => {
      stream.once('message', (data) => resolve(data.toString()));
      stream.once('error', reject);
    });
    let worker = await startWorker(databaseUrl, { info: () => {}, error: () => {} });
    try {
      expect(JSON.parse(await connected).type).toBe('agenda.connected');
      const event = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Evento do worker não chegou')), 5000);
        stream.once('message', (data) => {
          clearTimeout(timer);
          resolve(data.toString());
        });
      });
      await worker.boss.send(recurrenceQueue, {});
      const deadline = Date.now() + 10_000;
      let count = 0;
      while (Date.now() < deadline) {
        count = (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date=$3',
            [org, versionId, nextDate],
          )
        ).rows[0]!.n;
        if (count === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(count).toBe(1);
      expect(JSON.parse(await event)).toEqual({
        type: 'agenda.invalidate',
        kind: 'reservation.changed',
      });
      await worker.stop();
      worker = await startWorker(databaseUrl, { info: () => {}, error: () => {} });
      await worker.boss.send(recurrenceQueue, {});
      expect((await generateRecurrences(pool, contractId)).generated).toBe(0);
      expect(
        (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2',
            [org, versionId],
          )
        ).rows[0]!.n,
      ).toBe(1);
    } finally {
      stream.close();
      await worker.stop();
    }
  });
  it('recupera geração recorrente após falha SQL intermediária sem efeito parcial', async () => {
    const failureDate = new Date(new Date(date + 'T12:00:00Z').getTime() + 7 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const contractId = (
      await pool.query<{ id: string }>(
        "INSERT INTO arena_identity.recurrence_contracts(organization_id,customer_id,billing_mode) VALUES($1,$2,'PER_OCCURRENCE') RETURNING id",
        [org, customer],
      )
    ).rows[0]!.id;
    const recurrenceId = (
      await pool.query<{ id: string }>(
        `INSERT INTO arena_identity.recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
         duration_minutes,starts_on,ends_on,effective_from,price_cents)
         VALUES($1,$2,$3,$4,$5,'10:00',60,$6,$6,$6,9000) RETURNING id`,
        [org, contractId, b, sport, weekday, failureDate],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO arena_identity.recurrence_rules(organization_id,recurrence_id,weekday,start_time,duration_minutes) VALUES($1,$2,$3,'10:00',60)",
      [org, recurrenceId, weekday],
    );
    await pool.query(`CREATE FUNCTION arena_identity.phase4_test_fail_occ() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.reservation_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM arena_identity.reservations
          WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id
            AND recurrence_id='${recurrenceId}'::uuid
        ) THEN RAISE EXCEPTION 'induced recurrence failure' USING ERRCODE='P0001'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER phase4_test_fail_occ BEFORE INSERT ON arena_identity.schedule_occupancies
      FOR EACH ROW EXECUTE FUNCTION arena_identity.phase4_test_fail_occ()`);
    try {
      await expect(generateRecurrences(pool, contractId)).rejects.toMatchObject({ code: 'P0001' });
      expect(
        (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2',
            [org, recurrenceId],
          )
        ).rows[0]!.n,
      ).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER phase4_test_fail_occ ON arena_identity.schedule_occupancies');
      await pool.query('DROP FUNCTION arena_identity.phase4_test_fail_occ()');
    }
    const worker = await startWorker(databaseUrl, { info: () => {}, error: () => {} });
    try {
      await worker.boss.send(recurrenceQueue, {});
      let count = 0;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        count = (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM arena_identity.reservations WHERE organization_id=$1 AND recurrence_id=$2',
            [org, recurrenceId],
          )
        ).rows[0]!.n;
        if (count === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(count).toBe(1);
      expect((await generateRecurrences(pool, contractId)).generated).toBe(0);
      expect(
        (
          await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM arena_identity.schedule_occupancies o
             JOIN arena_identity.reservations r ON r.organization_id=o.organization_id AND r.id=o.reservation_id
             WHERE r.organization_id=$1 AND r.recurrence_id=$2 AND o.active`,
            [org, recurrenceId],
          )
        ).rows[0]!.n,
      ).toBe(1);
    } finally {
      await worker.stop();
    }
  });
});
