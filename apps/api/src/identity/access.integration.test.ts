import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../__tests__/disposable-database.js';
import { buildApp } from '../app.js';
import { provision } from './provision.js';
const origin = 'http://localhost:3000',
  password = randomUUID(),
  root = '/api/v1',
  mail = new Map<string, string>();
let pool: Pool, app: FastifyInstance;
const org = 'a-' + randomUUID(),
  other = 'b-' + randomUUID(),
  email = org + '@example.org',
  guest = other + '@example.org';
type Login = { cookie: string; csrf: string };
async function request(
  method: HTTPMethods,
  path: string,
  s?: Login,
  body?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url: root + path,
    headers: { origin, ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}) },
    ...(body ? { payload: body } : {}),
  });
}
async function login(address: string) {
  const res = await request('POST', '/auth/login', undefined, { email: address, password });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  expect(res.headers['set-cookie']).toContain('HttpOnly');
  const me = await request('GET', '/auth/me', { cookie, csrf: '' });
  return { cookie, csrf: me.json().csrf as string };
}
beforeAll(async () => {
  const url = await requireDisposableDatabase();
  pool = new Pool({ connectionString: url });
  for (const slug of [org, other])
    await provision(pool, { slug, name: slug, ownerName: 'Owner', email, password });
});
beforeEach(async () => {
  const url = await requireDisposableDatabase();
  app = buildApp({
    databaseUrl: url,
    logLevel: 'silent',
    deliver: async (email, kind, value) => {
      mail.set(kind + email, value);
    },
  });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await pool?.end();
});
describe('identidade, propriedade e cargos por arena', () => {
  it('revalida sessão, destinatário, papéis e ownership em PostgreSQL', async () => {
    const base = '/orgs/' + org,
      b = '/orgs/' + other;
    expect((await request('GET', base + '/access')).statusCode).toBe(401);
    const a = await login(email);
    expect((await request('GET', '/auth/me', a)).json().organizations).toHaveLength(2);
    expect(
      (await request('POST', base + '/invites', { ...a, csrf: 'invalid' }, { email: guest }))
        .statusCode,
    ).toBe(403);
    expect((await request('POST', base + '/invites', a, { email: guest })).statusCode).toBe(200);
    const accept = { token: mail.get('invite' + guest), name: 'Equipe', password };
    expect((await request('POST', '/auth/invites/accept', undefined, accept)).statusCode).toBe(200);
    expect((await request('POST', '/auth/invites/accept', undefined, accept)).statusCode).toBe(400);
    const g = await login(guest);
    const id = (await request('GET', base + '/access', g)).json().userId;
    expect((await request('GET', b + '/access', g)).statusCode).toBe(404);
    const role = {
      name: 'Atendimento local',
      description: '',
      permissions: ['members.read', 'payments.record'],
    };
    const rid = (await request('POST', base + '/roles', a, role)).json().id;
    expect(
      (
        await request('PUT', base + '/members/' + id + '/roles', a, {
          roles: [(await request('GET', b + '/roles', a)).json()[0].id],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await request('PUT', base + '/members/' + id + '/roles', a, { roles: [rid] })).statusCode,
    ).toBe(200);
    expect((await request('GET', base + '/access', g)).json().permissions.sort()).toEqual(
      role.permissions,
    );
    expect((await request('GET', base + '/members', g)).body).not.toMatch(
      /password_hash|token_hash/,
    );
    expect(
      (await request('PUT', base + '/roles/' + rid, g, { ...role, permissions: ['finance.read'] }))
        .statusCode,
    ).toBe(403);
    expect(
      (await request('PUT', base + '/roles/' + rid, a, { ...role, permissions: [] })).statusCode,
    ).toBe(200);
    expect((await request('GET', base + '/members', g)).statusCode).toBe(403);
    const owner = base + '/members/' + id + '/owner';
    expect((await request('PUT', owner, g, { owner: true, password })).statusCode).toBe(403);
    expect(
      (await request('PUT', base + '/members/' + id + '/status', a, { status: 'suspended' }))
        .statusCode,
    ).toBe(200);
    expect((await request('GET', base + '/access', g)).statusCode).toBe(404);
    await request('PUT', base + '/members/' + id + '/status', a, { status: 'active' });
    expect((await request('PUT', owner, a, { owner: true, password })).statusCode).toBe(200);
    const aid = (await request('GET', base + '/access', a)).json().userId;
    const removal = await Promise.all([
      request('PUT', base + '/members/' + aid + '/owner', a, { owner: false, password }),
      request('PUT', owner, g, { owner: false, password }),
    ]);
    expect(removal.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM arena_identity.audit_logs WHERE action='owner.removed'",
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
    await request('POST', '/auth/logout', g);
    expect((await request('GET', '/auth/me', g)).statusCode).toBe(401);
  });
  it('protege recuperação, expiração de sessão e convite', async () => {
    const a = await login(email);
    const base = '/orgs/' + other;
    for (const address of [email, 'absent@example.org'])
      expect(
        (await request('POST', '/auth/password/forgot', undefined, { email: address })).json(),
      ).toEqual({ ok: true });
    const invalid = await request('POST', '/auth/login', undefined, { email, password: 'wrong' });
    expect(invalid.statusCode).toBe(401);
    const address = 'exp-' + guest;
    await request('POST', base + '/invites', a, { email: address });
    await pool.query(
      "UPDATE arena_identity.invites SET expires_at=now()-interval '1 second' WHERE email=$1",
      [address],
    );
    expect(
      (
        await request('POST', '/auth/invites/accept', undefined, {
          name: 'Equipe',
          password,
          token: mail.get('invite' + address),
        })
      ).statusCode,
    ).toBe(400);
    await pool.query(
      "UPDATE arena_identity.sessions SET seen_at=now()-interval '31 days' WHERE user_id=(SELECT id FROM arena_identity.users WHERE email=$1)",
      [email],
    );
    expect((await request('GET', '/auth/me', a)).statusCode).toBe(401);
    const reset = { token: mail.get('reset' + email), password: randomUUID() };
    expect((await request('POST', '/auth/password/reset', undefined, reset)).statusCode).toBe(200);
    expect((await request('POST', '/auth/password/reset', undefined, reset)).statusCode).toBe(400);
  });
  it('exige sessão e membership em cada rota, restringe delegação e invalida somente a arena revogada', async () => {
    const slug = 'c-' + randomUUID(),
      slugB = 'd-' + randomUUID(),
      ownerEmail = slug + '@example.org',
      delegateEmail = slugB + '@example.org';
    await provision(pool, { slug, name: slug, email: ownerEmail, ownerName: 'Gestão', password });
    await provision(pool, {
      slug: slugB,
      name: slugB,
      email: delegateEmail,
      ownerName: 'Gestão B',
      password,
    });
    const a = await login(ownerEmail),
      d = await login(delegateEmail),
      base = '/orgs/' + slug,
      id = randomUUID();
    const operations: [HTTPMethods, string][] = [
      ['GET', '/access'],
      ['GET', '/context'],
      ['PATCH', ''],
      ['PUT', '/theme'],
      ['GET', '/audit-logs'],
      ['GET', '/members'],
      ['GET', '/roles'],
      ['POST', '/roles'],
      ['PUT', '/roles/' + id],
      ['DELETE', '/roles/' + id],
      ['PUT', '/members/' + id + '/status'],
      ['PUT', '/members/' + id + '/roles'],
      ['PUT', '/members/' + id + '/owner'],
      ['GET', '/invites'],
      ['POST', '/invites'],
      ['DELETE', '/invites/' + id],
    ];
    for (const [method, path] of operations) {
      const body = path === '/invites' && method === 'POST' ? { email: delegateEmail } : undefined;
      expect((await request(method, base + path, undefined, body)).statusCode, path).toBe(401);
      expect((await request(method, base + path, d, body)).statusCode, path).toBe(404);
    }
    await request('POST', base + '/invites', a, { email: delegateEmail });
    const secret = mail.get('invite' + delegateEmail);
    expect(
      (
        await request('POST', '/auth/invites/accept', undefined, {
          name: 'Existing',
          password: 'outro-segredo-longo',
          token: secret,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request('POST', '/auth/invites/accept', undefined, {
          name: 'Existing',
          password,
          token: secret,
        })
      ).statusCode,
    ).toBe(200);
    const subject = (await request('GET', base + '/access', d)).json().userId;
    const caps = ['roles.manage', 'roles.assign'];
    const role = { name: 'Delegação', description: '', permissions: caps };
    const rid = (await request('POST', base + '/roles', a, role)).json().id;
    expect(
      (await request('PUT', base + '/members/' + subject + '/roles', a, { roles: [rid] }))
        .statusCode,
    ).toBe(200);
    for (const [method, path, body] of [
      ['POST', '/roles', { ...role, name: 'Extra', permissions: ['finance.read'] }],
      ['PUT', '/roles/' + rid, role],
      ['PUT', '/members/' + subject + '/roles', { roles: [] }],
      ['PATCH', '', { name: 'Arena', timezone: 'UTC' }],
    ] as const)
      expect((await request(method, base + path, d, body)).statusCode).toBe(403);
    expect((await request('GET', base + '/audit-logs', d)).statusCode).toBe(403);
    expect((await request('GET', base + '/audit-logs', a)).json()).not.toHaveLength(0);
    expect(
      (await request('PATCH', base, a, { name: 'Arena', timezone: 'invalid' })).statusCode,
    ).toBe(400);
    expect(
      (await request('PATCH', base, a, { name: 'Atualizada', timezone: 'UTC' })).statusCode,
    ).toBe(200);
    expect((await request('GET', base + '/context', a)).json().name).toBe('Atualizada');
    expect(
      (await request('PUT', base + '/members/' + subject + '/status', a, { status: 'revoked' }))
        .statusCode,
    ).toBe(200);
    expect((await request('GET', base + '/context', d)).statusCode).toBe(404);
    expect((await request('GET', '/orgs/' + slugB + '/context', d)).statusCode).toBe(200);
    const second = await login(delegateEmail),
      sessions = (await request('GET', '/auth/sessions', d)).json() as {
        id: string;
        current: boolean;
      }[];
    expect(sessions).toHaveLength(2);
    expect(
      (await request('DELETE', '/auth/sessions/' + sessions.find((x) => !x.current)!.id, d))
        .statusCode,
    ).toBe(200);
    expect((await request('GET', '/auth/me', second)).statusCode).toBe(401);
    expect(
      (
        await request('POST', '/auth/password/change', d, {
          currentPassword: password,
          password: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await request('GET', '/auth/me', d)).statusCode).toBe(401);
  });
  it('o banco preserva proprietário ativo e histórico fora da rota', async () => {
    const slug = 'guard-' + randomUUID();
    const ownerEmail = slug + '@example.org';
    const id = await provision(pool, {
      slug,
      name: slug,
      email: ownerEmail,
      ownerName: 'Owner',
      password,
    });
    await expect(
      pool.query('UPDATE arena_identity.memberships SET is_owner=false WHERE organization_id=$1', [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE arena_identity.users SET disabled_at=now() WHERE email=$1', [ownerEmail]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM arena_identity.audit_logs WHERE organization_id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('limita tentativas inválidas e recusa origem externa mesmo com cookie e CSRF válidos', async () => {
    const slug = 'origin-' + randomUUID(),
      address = slug + '@example.org';
    await provision(pool, { slug, name: slug, email: address, ownerName: 'Owner', password });
    const a = await login(address);
    const response = await app.inject({
      url: root + '/auth/logout',
      method: 'POST',
      headers: { cookie: a.cookie, origin: 'https://invalid.example', 'x-csrf-token': a.csrf },
    });
    expect(response.statusCode).toBe(403);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request('POST', '/auth/login', undefined, {
            email: 'missing@example.org',
            password,
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (await request('POST', '/auth/login', undefined, { email: 'missing@example.org', password }))
        .statusCode,
    ).toBe(429);
  });
});
