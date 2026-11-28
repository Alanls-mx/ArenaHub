import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { requireDisposableDatabase } from '../__tests__/disposable-database.js';
import { buildApp } from '../app.js';
import { provision } from '../identity/provision.js';
import { localToInstant } from '../shared/time/index.js';
import { generateRecurrences } from './generate.js';

type Writer = 'booking' | 'recurrence' | 'block';
type Login = { cookie: string; csrf: string };
const origin = 'http://localhost:3000';
const slug = 'three-writers-' + randomUUID();
const email = slug + '@example.org';
const password = randomUUID();
const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
let app: FastifyInstance;
let pool: Pool;
let recurrencePool: Pool;
let org: string;
let customer: string;
let sport: string;
let venue: string;
let unitIds: string[];
let logins: Login[];

async function request(
  login: Login,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  key?: string,
) {
  return app.inject({
    method,
    url: `/api/v1/orgs/${slug}${path}`,
    headers: {
      origin,
      cookie: login.cookie,
      'x-csrf-token': login.csrf,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body ? { payload: body } : {}),
  });
}

async function login(): Promise<Login> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { origin, cookie },
  });
  expect(me.statusCode).toBe(200);
  return { cookie, csrf: me.json().csrf };
}

async function recurrenceFor(time: string) {
  const contract = (
    await pool.query<{ id: string }>(
      "INSERT INTO arena_identity.recurrence_contracts(organization_id,customer_id,billing_mode) VALUES($1,$2,'PER_OCCURRENCE') RETURNING id",
      [org, customer],
    )
  ).rows[0]!.id;
  const version = (
    await pool.query<{ id: string }>(
      `INSERT INTO arena_identity.recurrences(organization_id,contract_id,venue_id,sport_id,weekday,start_time,
       duration_minutes,starts_on,ends_on,effective_from,price_cents)
       VALUES($1,$2,$3,$4,$5,$6,60,$7,$7,$7,9000) RETURNING id`,
      [org, contract, venue, sport, weekday, time, date],
    )
  ).rows[0]!.id;
  await pool.query(
    'INSERT INTO arena_identity.recurrence_rules(organization_id,recurrence_id,weekday,start_time,duration_minutes) VALUES($1,$2,$3,$4,60)',
    [org, version, weekday, time],
  );
  return { contract, version };
}

async function blockedPids(excluded: Set<number>, count: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = (
      await pool.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity WHERE datname=current_database()
         AND state='active' AND wait_event_type='Lock'
         AND query LIKE 'SELECT id FROM venues WHERE organization_id=$1 AND id=$2%FOR UPDATE%'`,
      )
    ).rows;
    const pids = rows.map((row) => row.pid).filter((pid) => !excluded.has(pid));
    if (pids.length >= count) return pids;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(`Barreira PostgreSQL: esperados ${count} escritores bloqueados`);
}

async function stream() {
  const port = (app.server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://localhost:${port}/api/v1/orgs/${slug}/agenda/stream`, {
    headers: { origin, cookie: logins[2]!.cookie },
  });
  const events: string[] = [];
  socket.on('message', (data) => {
    const event = JSON.parse(data.toString()) as { type: string; kind?: string };
    if (event.type === 'agenda.invalidate' && event.kind) events.push(event.kind);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WebSocket não conectou')), 5_000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      expect(JSON.parse(data.toString()).type).toBe('agenda.connected');
      resolve();
    });
    socket.once('error', reject);
  });
  return { socket, events };
}

async function flushEvents(events: string[]) {
  // A sentinela percorre o mesmo LISTEN/NOTIFY e a mesma fila de autorização do canal.
  await pool.query('SELECT pg_notify($1,$2)', [
    'arenahub_agenda',
    JSON.stringify({ org, kind: 'recurrence.changed' }),
  ]);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (events.includes('recurrence.changed')) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Sentinela WebSocket não recebida');
}

beforeAll(async () => {
  const databaseUrl = await requireDisposableDatabase();
  pool = new Pool({ connectionString: databaseUrl, max: 5 });
  recurrencePool = new Pool({ connectionString: databaseUrl, max: 2 });
  await provision(pool, { slug, name: 'Três escritores', ownerName: 'Owner', email, password });
  org = (
    await pool.query<{ id: string }>('SELECT id FROM arena_identity.organizations WHERE slug=$1', [
      slug,
    ])
  ).rows[0]!.id;
  app = buildApp({ databaseUrl, logLevel: 'silent', deliver: async () => {} });
  logins = await Promise.all([login(), login(), login()]);
  const owner = logins[0]!;
  const createdCustomer = await request(owner, 'POST', '/customers', {
    name: 'Cliente',
    phone: null,
    email: null,
  });
  expect(createdCustomer.statusCode, createdCustomer.body).toBe(200);
  customer = createdCustomer.json().id;
  const createdSport = await request(owner, 'POST', '/sports', { name: 'Futebol' });
  expect(createdSport.statusCode, createdSport.body).toBe(200);
  sport = createdSport.json().id;
  unitIds = [];
  for (const name of ['Metade A', 'Metade B']) {
    const unit = await request(owner, 'POST', '/units', { name });
    expect(unit.statusCode, unit.body).toBe(200);
    unitIds.push(unit.json().id);
  }
  const createdVenue = await request(owner, 'POST', '/venues', {
    name: 'Campo completo',
    unitIds,
    sportIds: [sport],
    defaultPricePerHourCents: 9000,
    color: null,
    sortOrder: 0,
  });
  expect(createdVenue.statusCode, createdVenue.body).toBe(200);
  venue = createdVenue.json().id;
  const hours = await app.inject({
    method: 'PUT',
    url: `/api/v1/orgs/${slug}/venues/${venue}/operating-hours`,
    headers: { origin, cookie: owner.cookie, 'x-csrf-token': owner.csrf },
    payload: { shifts: [{ weekday, openTime: '06:00', closeTime: '23:00', spansFullDay: false }] },
  });
  expect(hours.statusCode, hours.body).toBe(200);
  await app.listen({ host: '127.0.0.1', port: 0 });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await recurrencePool?.end();
  await pool?.end();
});

describe('três escritores reais no mesmo venue e nas mesmas unidades', () => {
  for (const [winner, time] of [
    ['booking', '09:00'],
    ['recurrence', '11:00'],
    ['block', '13:00'],
  ] as const) {
    it(`serializa os três com ${winner} primeiro`, async () => {
      const started = Date.now();
      const { contract, version } = await recurrenceFor(time);
      const keyBooking = randomUUID();
      const keyBlock = randomUUID();
      const actions: Record<Writer, () => Promise<unknown>> = {
        booking: () =>
          request(
            logins[0]!,
            'POST',
            '/reservations',
            {
              customerId: customer,
              venueId: venue,
              sportId: sport,
              date,
              startTime: time,
              durationMinutes: 60,
              initialStatus: 'PENDING',
              source: 'IN_PERSON',
              notes: '',
            },
            keyBooking,
          ),
        recurrence: () => generateRecurrences(recurrencePool, contract),
        block: () =>
          request(
            logins[1]!,
            'POST',
            '/blocks',
            {
              venueId: venue,
              date,
              startTime: time,
              durationMinutes: 60,
              reason: 'Manutenção',
            },
            keyBlock,
          ),
      };
      const { socket, events } = await stream();
      let holder: PoolClient | undefined;
      const tasks = {} as Record<Writer, Promise<unknown>>;
      const observed = new Set<number>();
      try {
        holder = await pool.connect();
        await holder.query('BEGIN');
        await holder.query('SET LOCAL search_path TO arena_identity, public');
        await holder.query('SELECT id FROM venues WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
          org,
          venue,
        ]);
        const order: Writer[] = [
          winner,
          ...(['booking', 'recurrence', 'block'] as Writer[]).filter((name) => name !== winner),
        ];
        for (const name of order) {
          tasks[name] = actions[name]();
          const [pid] = await blockedPids(observed, 1);
          observed.add(pid!);
        }
        expect(observed.size).toBe(3);
        await holder.query('COMMIT');
        holder.release();
        holder = undefined;
        const [book, recurrent, block] = (await Promise.all([
          tasks.booking,
          tasks.recurrence,
          tasks.block,
        ])) as [
          Awaited<ReturnType<typeof request>>,
          Awaited<ReturnType<typeof generateRecurrences>>,
          Awaited<ReturnType<typeof request>>,
        ];
        const expected = (name: Writer) => (name === winner ? 200 : 409);
        expect(book.statusCode, book.body).toBe(expected('booking'));
        expect(block.statusCode, block.body).toBe(expected('block'));
        if (winner !== 'booking') expect(book.json().code).toBe('SLOT_UNAVAILABLE');
        if (winner !== 'block') expect(block.json().code).toBe('SLOT_UNAVAILABLE');
        expect(recurrent).toEqual(
          winner === 'recurrence'
            ? { generated: 1, conflict: 0, existing: 0 }
            : { generated: 0, conflict: 1, existing: 0 },
        );
        const startAt = localToInstant(`${date}T${time}`, 'America/Sao_Paulo').toString();
        const reservations = (
          await pool.query<{ id: string; recurrence_id: string | null }>(
            'SELECT id,recurrence_id FROM arena_identity.reservations WHERE organization_id=$1 AND venue_id=$2 AND start_at=$3',
            [org, venue, startAt],
          )
        ).rows;
        const blocks = (
          await pool.query<{ id: string }>(
            'SELECT id FROM arena_identity.venue_blocks WHERE organization_id=$1 AND venue_id=$2 AND start_at=$3 AND cancelled_at IS NULL',
            [org, venue, startAt],
          )
        ).rows;
        expect(reservations).toHaveLength(winner === 'block' ? 0 : 1);
        expect(blocks).toHaveLength(winner === 'block' ? 1 : 0);
        if (winner === 'booking') expect(reservations[0]!.recurrence_id).toBeNull();
        if (winner === 'recurrence') expect(reservations[0]!.recurrence_id).toBe(version);
        const occupancy = (
          await pool.query<{
            unit_id: string;
            reservation_id: string | null;
            block_id: string | null;
          }>(
            `SELECT unit_id,reservation_id,block_id FROM arena_identity.schedule_occupancies
           WHERE organization_id=$1 AND active AND start_at=$2 ORDER BY unit_id`,
            [org, startAt],
          )
        ).rows;
        expect(occupancy).toHaveLength(2);
        expect(new Set(occupancy.map((row) => row.unit_id))).toEqual(new Set(unitIds));
        expect(
          occupancy.every((row) =>
            winner === 'block'
              ? row.block_id === blocks[0]!.id && row.reservation_id === null
              : row.reservation_id === reservations[0]!.id && row.block_id === null,
          ),
        ).toBe(true);
        const integrity = (
          await pool.query<{ orphan_count: number; overlap_count: number }>(
            `SELECT
             (SELECT count(*)::int FROM arena_identity.schedule_occupancies o
              LEFT JOIN arena_identity.reservations r ON r.organization_id=o.organization_id AND r.id=o.reservation_id
              LEFT JOIN arena_identity.venue_blocks b ON b.organization_id=o.organization_id AND b.id=o.block_id
              WHERE o.organization_id=$1 AND o.start_at=$2
                AND ((o.reservation_id IS NOT NULL AND r.id IS NULL)
                  OR (o.block_id IS NOT NULL AND b.id IS NULL))) AS orphan_count,
             (SELECT count(*)::int FROM arena_identity.schedule_occupancies x
              JOIN arena_identity.schedule_occupancies y
                ON x.organization_id=y.organization_id AND x.unit_id=y.unit_id
               AND x.id<y.id AND x.period && y.period
              WHERE x.organization_id=$1 AND x.active AND y.active AND x.start_at=$2) AS overlap_count`,
            [org, startAt],
          )
        ).rows[0]!;
        expect(integrity).toEqual({ orphan_count: 0, overlap_count: 0 });
        const exceptions = (
          await pool.query<{ kind: string; reason: string }>(
            'SELECT kind,reason FROM arena_identity.recurrence_exceptions WHERE organization_id=$1 AND recurrence_id=$2 AND occurrence_date=$3',
            [org, version, date],
          )
        ).rows;
        expect(exceptions).toEqual(
          winner === 'recurrence' ? [] : [{ kind: 'CONFLICT', reason: 'SLOT_UNAVAILABLE' }],
        );
        const history = (
          await pool.query<{ action: string }>(
            'SELECT action FROM arena_identity.reservation_history WHERE organization_id=$1 AND reservation_id=$2',
            [org, reservations[0]?.id ?? null],
          )
        ).rows;
        expect(history).toHaveLength(winner === 'block' ? 0 : 1);
        expect(history[0]?.action).toBe(
          winner === 'booking' ? 'created' : winner === 'recurrence' ? 'generated' : undefined,
        );
        const keys = (
          await pool.query<{ key: string }>(
            'SELECT key FROM arena_identity.idempotency_keys WHERE organization_id=$1 AND key=ANY($2::text[])',
            [org, [keyBooking, keyBlock]],
          )
        ).rows;
        expect(keys.map((row) => row.key)).toEqual(
          [winner === 'booking' ? keyBooking : winner === 'block' ? keyBlock : undefined].filter(
            Boolean,
          ),
        );
        const replay = await generateRecurrences(recurrencePool, contract);
        expect(replay.generated).toBe(0);
        expect(replay.conflict).toBe(0);
        const availability = await request(
          logins[0]!,
          'GET',
          `/availability?venueId=${venue}&date=${date}&startTime=${encodeURIComponent(time)}&durationMinutes=60`,
        );
        expect(availability.statusCode, availability.body).toBe(200);
        expect(availability.json().available).toBe(false);
        await flushEvents(events);
        const success = events.filter(
          (kind) => kind === 'reservation.changed' || kind === 'block.changed',
        );
        expect(success.length).toBeLessThanOrEqual(1);
        expect(
          success.every(
            (kind) => kind === (winner === 'block' ? 'block.changed' : 'reservation.changed'),
          ),
        ).toBe(true);
        console.info(
          JSON.stringify({
            scenario: winner,
            blockedPids: [...observed],
            booking: book.statusCode,
            recurrence: recurrent,
            block: block.statusCode,
            occupancy: occupancy.length,
            notifications: events,
            elapsedMs: Date.now() - started,
          }),
        );
      } finally {
        if (holder) {
          await holder.query('ROLLBACK').catch(() => undefined);
          holder.release();
        }
        socket.close();
      }
    }, 30_000);
  }
});
