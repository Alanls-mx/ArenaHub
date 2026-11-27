import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../__tests__/disposable-database.js';
import { buildApp } from '../app.js';
import { provision } from '../identity/provision.js';

const origin = 'http://localhost:3000',
  password = randomUUID(),
  slug = 'phase3-' + randomUUID(),
  other = 'foreign-' + randomUUID(),
  staffOrg = 'staff-' + randomUUID();
const owner = slug + '@example.org',
  staff = staffOrg + '@example.org';
let pool: Pool, app: FastifyInstance;
type Login = { cookie: string; csrf: string };
async function req(method: HTTPMethods, path: string, s?: Login, body?: unknown) {
  return app.inject({
    method,
    url: '/api/v1/orgs/' + slug + path,
    headers: { origin, ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}) },
    ...(body ? { payload: body } : {}),
  });
}
async function login(email: string): Promise<Login> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { origin, cookie },
  });
  return { cookie, csrf: me.json().csrf };
}
beforeAll(async () => {
  const url = await requireDisposableDatabase();
  pool = new Pool({ connectionString: url });
  await provision(pool, { slug, name: 'Arena Fase 3', ownerName: 'Owner', email: owner, password });
  await provision(pool, { slug: other, name: 'Outra', ownerName: 'Owner', email: owner, password });
  await provision(pool, {
    slug: staffOrg,
    name: 'Staff',
    ownerName: 'Staff',
    email: staff,
    password,
  });
  const orgId = (
    await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [slug])
  ).rows[0].id;
  const userId = (await pool.query('SELECT id FROM arena_identity.users WHERE email=$1', [staff]))
    .rows[0].id;
  await pool.query(
    'INSERT INTO arena_identity.memberships(organization_id,user_id) VALUES($1,$2)',
    [orgId, userId],
  );
  await pool.query(
    "INSERT INTO arena_identity.membership_roles(organization_id,user_id,role_id) SELECT $1,$2,id FROM arena_identity.roles WHERE organization_id=$1 AND name='Staff'",
    [orgId, userId],
  );
  app = buildApp({ databaseUrl: url, logLevel: 'silent', deliver: async () => {} });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});
describe('estrutura operacional real', () => {
  it('isola clientes e recursos e aplica capability', async () => {
    const own = await login(owner),
      worker = await login(staff);
    expect((await req('GET', '/customers', undefined)).statusCode).toBe(401);
    const c = (
      await req('POST', '/customers', own, {
        name: 'Cliente fictício',
        phone: '+5511999999999',
        email: null,
      })
    ).json().id;
    expect(
      (await req('GET', '/customers', worker)).json().items.some((x: { id: string }) => x.id === c),
    ).toBe(true);
    expect((await req('POST', '/venues', worker, { name: 'Proibido' })).statusCode).toBe(403);
    expect((await req('DELETE', '/customers/' + c, worker)).statusCode).toBe(403);
    const another = (
      await req('POST', '/customers', own, {
        name: 'Pessoa da lista',
        phone: null,
        email: 'PESSOA@EXAMPLE.ORG',
      })
    ).json().id;
    const first = (await req('GET', '/customers?limit=1', own)).json();
    const second = (await req('GET', '/customers?limit=1&cursor=' + first.nextCursor, own)).json();
    expect(new Set([...first.items, ...second.items].map((x: { id: string }) => x.id))).toEqual(
      new Set([c, another]),
    );
    expect(
      (await req('GET', '/customers?q=Pessoa', own)).json().items.map((x: { id: string }) => x.id),
    ).toEqual([another]);
    expect(
      (
        await req('PATCH', '/customers/' + another, own, {
          name: 'Pessoa editada',
          phone: null,
          email: 'pessoa@example.org',
        })
      ).statusCode,
    ).toBe(200);
    expect((await req('DELETE', '/customers/' + another, own)).statusCode).toBe(200);
    expect((await req('GET', '/customers?q=Pessoa', own)).json().items).toHaveLength(0);
    const foreign = await app.inject({
      method: 'GET',
      url: '/api/v1/orgs/' + other + '/customers',
      headers: { origin, cookie: own.cookie },
    });
    expect(foreign.json().items).toHaveLength(0);
    expect(
      (await req('PATCH', '/customers/' + randomUUID(), own, { name: 'Inexistente' })).statusCode,
    ).toBe(404);
  });
  it('cria composição compartilhada, bloqueia referência cruzada e arquivamento em uso', async () => {
    const own = await login(owner);
    const sport = (await req('POST', '/sports', own, { name: 'Futebol Society' })).json().id;
    const a = (await req('POST', '/units', own, { name: 'Parte A' })).json().id;
    const b = (await req('POST', '/units', own, { name: 'Parte B' })).json().id;
    const create = (name: string, unitIds: string[]) =>
      req('POST', '/venues', own, {
        name,
        sportIds: [sport],
        unitIds,
        defaultPricePerHourCents: 8000,
        color: null,
        sortOrder: 0,
      });
    expect((await create('Campo A', [a])).statusCode).toBe(200);
    expect((await create('Campo B', [b])).statusCode).toBe(200);
    const full = (await create('Campo completo', [a, b])).json().id;
    const simple = (
      await req('POST', '/venues', own, {
        name: 'Quadra simples',
        sportIds: [],
        defaultPricePerHourCents: null,
        color: null,
        sortOrder: 0,
      })
    ).json().id;
    expect(
      (await req('GET', '/venues', own)).json().items.find((v: { id: string }) => v.id === simple)
        .unit_ids,
    ).toHaveLength(1);
    const firstVenues = (await req('GET', '/venues?limit=2', own)).json();
    const nextVenues = (
      await req('GET', '/venues?limit=2&cursor=' + firstVenues.nextCursor, own)
    ).json();
    expect(
      [...firstVenues.items, ...nextVenues.items].map((v: { name: string }) => v.name),
    ).toEqual(['Campo A', 'Campo B', 'Campo completo', 'Quadra simples']);
    expect(
      (await req('PUT', '/venues/' + full + '/units', own, { unitIds: [a, a] })).statusCode,
    ).toBe(400);
    expect(
      (await req('PUT', '/venues/' + full + '/units', own, { unitIds: [randomUUID()] })).statusCode,
    ).toBe(404);
    expect((await req('DELETE', '/units/' + a, own)).statusCode).toBe(409);
    const orgId = (
      await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [slug])
    ).rows[0].id;
    const foreignOrg = (
      await pool.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [other])
    ).rows[0].id;
    await expect(
      pool.query(
        'INSERT INTO arena_identity.venue_unit_links(organization_id,venue_id,unit_id) VALUES($1,$2,$3)',
        [foreignOrg, full, a],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM arena_identity.venue_unit_links WHERE organization_id=$1 AND venue_id=$2',
          [orgId, full],
        )
      ).rows[0].n,
    ).toBe(2);
    expect((await req('PUT', '/venues/' + full + '/units', own, { unitIds: [a] })).statusCode).toBe(
      200,
    );
    expect(
      (await req('PUT', '/venues/' + full + '/units', own, { unitIds: [a, b] })).statusCode,
    ).toBe(200);
    await expect(
      pool.query(
        'DELETE FROM arena_identity.venue_unit_links WHERE organization_id=$1 AND venue_id=$2',
        [orgId, simple],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'UPDATE arena_identity.venue_unit_links SET venue_id=$3 WHERE organization_id=$1 AND venue_id=$2',
        [orgId, simple, full],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('valida turno noturno, exceção global e simulação sem efeitos', async () => {
    const own = await login(owner),
      v = (await req('GET', '/venues', own))
        .json()
        .items.find((x: { name: string }) => x.name === 'Campo completo').id;
    expect(
      (
        await req('PUT', '/venues/' + v + '/operating-hours', own, {
          shifts: [
            { weekday: 0, openTime: '22:00', closeTime: '02:00', spansFullDay: false },
            { weekday: 1, openTime: '01:00', closeTime: '03:00', spansFullDay: false },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await req('PUT', '/venues/' + v + '/operating-hours', own, {
          shifts: [
            { weekday: 0, openTime: '22:00', closeTime: '02:00', spansFullDay: false },
            { weekday: 2, openTime: '00:00', closeTime: '00:00', spansFullDay: true },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const exception = {
      venueId: null,
      date: '2026-12-25',
      kind: 'CLOSED',
      openTime: null,
      closeTime: null,
      description: 'Feriado',
    };
    expect((await req('POST', '/calendar-exceptions', own, exception)).statusCode).toBe(200);
    expect((await req('POST', '/calendar-exceptions', own, exception)).statusCode).toBe(409);
    const before = (await pool.query('SELECT count(*)::int AS n FROM arena_identity.audit_logs'))
      .rows[0].n;
    const result = await req(
      'GET',
      '/pricing/quote?venueId=' + v + '&date=2026-11-24&startTime=19:00&durationMinutes=60',
      own,
    );
    expect(result.json().totalCents).toBe(8000);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM arena_identity.audit_logs')).rows[0].n,
    ).toBe(before);
  });
  it('serializa alterações de preço concorrentes e rejeita sobreposição', async () => {
    const own = await login(owner),
      v = (await req('GET', '/venues', own))
        .json()
        .items.find((x: { name: string }) => x.name === 'Campo completo').id;
    const rule = {
      venueId: v,
      sportId: null,
      specificDate: null,
      weekday: 2,
      startTime: '18:00',
      endTime: '20:00',
      pricePerHourCents: 10000,
      validFrom: null,
      validUntil: null,
    };
    const results = await Promise.all([
      req('POST', '/pricing-rules', own, rule),
      req('POST', '/pricing-rules', own, { ...rule, startTime: '19:00', endTime: '21:00' }),
    ]);
    expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((x) => x.statusCode === 409)?.json().code).toBe('PRICING_RULE_OVERLAP');
    const result = await req(
      'GET',
      '/pricing/quote?venueId=' + v + '&date=2026-11-24&startTime=18:30&durationMinutes=60',
      own,
    );
    expect(result.json().available).toBe(true);
    const created = results.find((x) => x.statusCode === 200)!.json().id;
    const accepted =
      results[0]!.statusCode === 200 ? rule : { ...rule, startTime: '19:00', endTime: '21:00' };
    expect(
      (
        await req('PATCH', '/pricing-rules/' + created, own, {
          ...accepted,
          pricePerHourCents: 11000,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await req(
          'GET',
          '/pricing/quote?venueId=' + v + '&date=2026-11-24&startTime=19:00&durationMinutes=60',
          own,
        )
      ).json().totalCents,
    ).toBe(11000);
    expect((await req('DELETE', '/pricing-rules/' + created, own)).statusCode).toBe(200);
    expect(
      (
        await req(
          'GET',
          '/pricing/quote?venueId=' + v + '&date=2026-11-24&startTime=19:00&durationMinutes=60',
          own,
        )
      ).json().totalCents,
    ).toBe(8000);
  });
  it('registra apenas solicitação pendente de domínio próprio', async () => {
    const own = await login(owner),
      worker = await login(staff);
    expect(
      (await req('POST', '/domains/requests', worker, { hostname: 'agenda.exemplo.com.br' }))
        .statusCode,
    ).toBe(403);
    const request = await req('POST', '/domains/requests', own, {
      hostname: 'AGENDA.EXEMPLO.COM.BR',
    });
    expect(request.statusCode).toBe(200);
    expect(request.json().status).toBe('pending');
    expect(
      (await req('GET', '/domains', own))
        .json()
        .some(
          (x: { hostname: string; status: string }) =>
            x.hostname === 'agenda.exemplo.com.br' && x.status === 'pending',
        ),
    ).toBe(true);
    expect(
      (await req('POST', '/domains/requests', own, { hostname: 'agenda.exemplo.com.br' }))
        .statusCode,
    ).toBe(409);
  });
});
