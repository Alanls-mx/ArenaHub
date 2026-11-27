import { emailSchema, loginSchema, passwordSchema } from '@arenahub/contracts';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { audit, deny, encodePassword, hash, matches, token, transaction } from './core.js';
export type Delivery = (email: string, kind: 'invite' | 'reset', secret: string) => Promise<void>;
export interface IdentityOptions {
  origin: string;
  deliver: Delivery;
}
const cookieName = '__Host-session';
export function originCheck(r: FastifyRequest, origin: string) {
  if (
    r.headers.origin !== origin ||
    (r.headers.referer && !r.headers.referer.startsWith(origin + '/'))
  )
    deny(403);
}
export async function session(db: PoolClient, r: FastifyRequest, origin: string) {
  const secret = (r.headers.cookie ?? '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  if (!secret) deny(401);
  const csrf = hash('csrf:' + secret);
  if (r.method !== 'GET') {
    originCheck(r, origin);
    if (r.headers['x-csrf-token'] !== csrf) deny(403);
  }
  const found = await db.query<{ id: string; user_id: string; email: string; name: string }>(
    `SELECT s.id,u.id AS user_id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND revoked_at IS NULL AND disabled_at IS NULL AND seen_at>now()-interval '30 days' AND s.created_at>now()-interval '90 days' FOR UPDATE OF s`,
    [hash(secret)],
  );
  const identity = found.rows[0];
  if (!identity) deny(401);
  await db.query(
    "UPDATE sessions SET seen_at=now() WHERE id=$1 AND seen_at<now()-interval '5 minutes'",
    [identity.id],
  );
  return { ...identity, csrf };
}
function cookie(reply: FastifyReply, secret: string, age: number) {
  reply.header(
    'Set-Cookie',
    cookieName + '=' + secret + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + age,
  );
}
export async function authRoutes(app: FastifyInstance, pool: Pool, options: IdentityOptions) {
  await app.register(rateLimit, { global: true, max: 180, timeWindow: '1 minute' });
  const limited = { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } };
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          hook: 'preHandler',
          keyGenerator: (r: FastifyRequest) =>
            r.ip + ':' + hash(loginSchema.safeParse(r.body).data?.email ?? ''),
        },
      },
    },
    async (r, reply) => {
      originCheck(r, options.origin);
      const input = loginSchema.parse(r.body);
      const secret = await transaction(pool, async (db) => {
        const user = (
          await db.query(
            'SELECT id,password_hash,disabled_at FROM users WHERE email=$1 FOR SHARE',
            [input.email],
          )
        ).rows[0];
        if (!(await matches(input.password, user?.password_hash)) || !user || user.disabled_at)
          deny(401);
        const value = token();
        await db.query('INSERT INTO sessions(user_id,token_hash) VALUES($1,$2)', [
          user.id,
          hash(value),
        ]);
        return value;
      });
      cookie(reply, secret, 90 * 86400);
      return { ok: true };
    },
  );
  app.get('/auth/me', (r) =>
    transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      const orgs = await db.query(
        "SELECT slug,name FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE o.active AND m.status='active' AND m.user_id=$1 ORDER BY name",
        [s.user_id],
      );
      return { name: s.name, email: s.email, csrf: s.csrf, organizations: orgs.rows };
    }),
  );
  app.post('/auth/password/change', limited, async (r, reply) => {
    const body = z
      .strictObject({ currentPassword: z.string().max(128), password: passwordSchema })
      .parse(r.body);
    const next = await transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      const user = (
        await db.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [s.user_id])
      ).rows[0];
      if (!(await matches(body.currentPassword, user.password_hash))) deny(403);
      await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
        s.user_id,
        await encodePassword(body.password),
      ]);
      await db.query('DELETE FROM password_resets WHERE user_id=$1', [s.user_id]);
      await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [s.user_id]);
      const secret = token();
      await db.query('INSERT INTO sessions(user_id,token_hash) VALUES($1,$2)', [
        s.user_id,
        hash(secret),
      ]);
      await audit(db, s.user_id, null, 'password.changed', s.user_id, r.id);
      return secret;
    });
    cookie(reply, next, 90 * 86400);
    return { ok: true };
  });
  app.post('/auth/logout', async (r, reply) => {
    await transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [s.id]);
    });
    cookie(reply, '', 0);
    return { ok: true };
  });
  app.get('/auth/sessions', (r) =>
    transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      return (
        await db.query(
          "SELECT id,created_at,seen_at,id=$2 AS current FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND seen_at>now()-interval '30 days' AND created_at>now()-interval '90 days' ORDER BY seen_at DESC",
          [s.user_id, s.id],
        )
      ).rows;
    }),
  );
  app.delete('/auth/sessions/:id', (r) =>
    transaction(pool, async (db) => {
      const s = await session(db, r, options.origin);
      const { id } = z.object({ id: z.uuid() }).parse(r.params);
      if (
        !(
          await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id=$2', [
            s.user_id,
            id,
          ])
        ).rowCount
      )
        deny(404);
      await audit(db, s.user_id, null, 'session.revoked', id, r.id);
      return { ok: true };
    }),
  );
  app.post('/auth/password/forgot', limited, async (r, reply) => {
    originCheck(r, options.origin);
    const { email } = z.strictObject({ email: emailSchema }).parse(r.body);
    const secret = token();
    const sent = await transaction(
      pool,
      async (db) =>
        (
          await db.query(
            "INSERT INTO password_resets(token_hash,user_id,expires_at) SELECT $1,id,now()+interval '30 minutes' FROM users WHERE email=$2 AND disabled_at IS NULL",
            [hash(secret), email],
          )
        ).rowCount,
    );
    if (sent)
      void options
        .deliver(email, 'reset', secret)
        .catch(() => app.log.error('password recovery mail failed'));
    return reply.code(202).send({ ok: true });
  });
  app.post('/auth/password/reset', limited, async (r) => {
    originCheck(r, options.origin);
    const input = z
      .strictObject({ token: z.string().length(43), password: passwordSchema })
      .parse(r.body);
    return transaction(pool, async (db) => {
      const user = (
        await db.query(
          'SELECT u.id FROM users u JOIN password_resets p ON p.user_id=u.id WHERE p.token_hash=$1 AND p.expires_at>now() AND u.disabled_at IS NULL FOR UPDATE OF u',
          [hash(input.token)],
        )
      ).rows[0];
      if (!user) deny(400);
      if (
        !(
          await db.query(
            'DELETE FROM password_resets WHERE user_id=$1 AND token_hash=$2 RETURNING user_id',
            [user.id, hash(input.token)],
          )
        ).rowCount
      )
        deny(400);
      await db.query('DELETE FROM password_resets WHERE user_id=$1', [user.id]);
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
        await encodePassword(input.password),
        user.id,
      ]);
      await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
      await audit(db, user.id, null, 'password.reset', user.id, r.id);
      return { ok: true };
    });
  });
}
