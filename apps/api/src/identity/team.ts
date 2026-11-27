import {
  checkTheme,
  emailSchema,
  passwordSchema,
  permissionCodes,
  roleSchema,
  type Capability,
} from '@arenahub/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { validateTimeZone } from '../shared/time/index.js';
import { audit, deny, encodePassword, hash, matches, token, transaction } from './core.js';
import { originCheck, session, type IdentityOptions } from './session.js';

async function grants(db: PoolClient, org: string, user: string): Promise<Capability[]> {
  return (
    await db.query<{ code: Capability }>(
      'SELECT DISTINCT p.code FROM membership_roles m JOIN role_permissions p USING(organization_id,role_id) WHERE m.organization_id=$1 AND m.user_id=$2',
      [org, user],
    )
  ).rows.map((x) => x.code);
}
export function teamRoutes(app: FastifyInstance, pool: Pool, options: IdentityOptions) {
  async function context(db: PoolClient, r: FastifyRequest, need?: Capability) {
    const s = await session(db, r, options.origin);
    const { slug } = z.object({ slug: z.string().max(80) }).parse(r.params);
    const org = (
      await db.query(
        'SELECT id FROM organizations WHERE slug=$1 AND active ' +
          (r.method === 'GET' ? 'FOR SHARE' : 'FOR UPDATE'),
        [slug],
      )
    ).rows[0]?.id as string | undefined;
    if (!org) deny(404);
    const boundOrganization = options.hostOrganization?.(r);
    if (boundOrganization && boundOrganization !== org) deny(404);
    const actor = (
      await db.query(
        "SELECT is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
        [org, s.user_id],
      )
    ).rows[0];
    if (!actor) deny(404);
    const owner = Boolean(actor.is_owner),
      caps = owner ? [...permissionCodes] : await grants(db, org, s.user_id);
    if (need && !caps.includes(need)) deny(403);
    return {
      org,
      actor: s.user_id,
      owner,
      caps,
      log: (action: string, id: string) => audit(db, s.user_id, org, action, id, r.id),
      canDelegate: (codes: readonly Capability[]) => {
        if (codes.some((c) => !caps.includes(c))) deny(403);
      },
    };
  }
  type Ctx = Awaited<ReturnType<typeof context>>;
  function route<T>(
    r: FastifyRequest,
    cap: Capability | undefined,
    fn: (db: PoolClient, c: Ctx) => Promise<T>,
  ) {
    return transaction(pool, async (db) => fn(db, await context(db, r, cap)));
  }
  const base = '/orgs/:slug';
  const target = (r: FastifyRequest) => z.object({ id: z.uuid() }).parse(r.params).id;
  async function member(db: PoolClient, c: Ctx, id: string) {
    const row = (
      await db.query(
        'SELECT status,is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2',
        [c.org, id],
      )
    ).rows[0];
    if (!row) deny(404);
    return row;
  }
  async function editable(db: PoolClient, c: Ctx, id: string) {
    const row = await member(db, c, id);
    if (id === c.actor || row.is_owner) deny(403);
    c.canDelegate(await grants(db, c.org, id));
    return row;
  }
  app.get(base + '/context', (r) =>
    route(
      r,
      undefined,
      async (db, c) =>
        (
          await db.query(
            'SELECT o.id,o.slug,o.name,o.timezone,t.theme FROM organizations o LEFT JOIN organization_themes t ON t.organization_id=o.id WHERE o.id=$1',
            [c.org],
          )
        ).rows[0],
    ),
  );
  app.patch(base, (r) =>
    route(r, undefined, async (db, c) => {
      if (!c.owner) deny(403);
      const input = z
        .strictObject({ name: z.string().trim().min(1).max(120), timezone: z.string().max(80) })
        .parse(r.body);
      try {
        validateTimeZone(input.timezone);
      } catch {
        deny(400);
      }
      await db.query('UPDATE organizations SET name=$2,timezone=$3,updated_at=now() WHERE id=$1', [
        c.org,
        input.name,
        input.timezone,
      ]);
      await c.log('organization.updated', c.org);
      return { ok: true };
    }),
  );
  app.put(base + '/theme', (r) =>
    route(r, undefined, async (db, c) => {
      if (!c.owner) deny(403);
      let theme;
      try {
        theme = checkTheme(r.body);
      } catch {
        deny(400);
      }
      await db.query(
        'INSERT INTO organization_themes(organization_id,theme,published_by) VALUES($1,$2,$3) ON CONFLICT(organization_id) DO UPDATE SET previous_theme=organization_themes.theme,theme=excluded.theme,version=organization_themes.version+1,published_by=excluded.published_by,published_at=now()',
        [c.org, theme, c.actor],
      );
      await c.log('theme.published', c.org);
      return { ok: true };
    }),
  );
  app.get(base + '/audit-logs', (r) =>
    route(r, undefined, async (db, c) => {
      if (!c.owner) deny(403);
      const { before } = z
        .object({
          before: z
            .string()
            .regex(/^[0-9]{1,18}$/)
            .optional(),
        })
        .parse(r.query);
      return (
        await db.query(
          'SELECT id,actor_id,action,entity,request_id,created_at FROM audit_logs WHERE organization_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 50',
          [c.org, before ?? null],
        )
      ).rows;
    }),
  );
  app.get(base + '/access', (r) =>
    route(r, undefined, async (_db, c) => ({
      userId: c.actor,
      owner: c.owner,
      permissions: c.caps,
    })),
  );
  app.get(base + '/members', (r) =>
    route(r, undefined, async (db, c) => {
      if (!c.caps.some((p) => ['members.read', 'members.manage', 'roles.assign'].includes(p)))
        deny(403);
      return (
        await db.query(
          'SELECT u.id,u.name,u.email,m.status,m.is_owner,ARRAY(SELECT role_id FROM membership_roles a WHERE a.organization_id=m.organization_id AND a.user_id=m.user_id) AS roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.name',
          [c.org],
        )
      ).rows;
    }),
  );
  app.get(base + '/roles', (r) =>
    route(r, undefined, async (db, c) => {
      if (!c.caps.some((p) => ['members.read', 'roles.assign', 'roles.manage'].includes(p)))
        deny(403);
      return (
        await db.query(
          'SELECT r.id,r.name,r.description,ARRAY(SELECT code FROM role_permissions p WHERE p.organization_id=r.organization_id AND p.role_id=r.id) AS permissions,(SELECT count(*)::int FROM membership_roles m WHERE m.organization_id=r.organization_id AND m.role_id=r.id) AS members FROM roles r WHERE organization_id=$1 ORDER BY name',
          [c.org],
        )
      ).rows;
    }),
  );
  async function saveRole(r: FastifyRequest, id?: string, deleting = false) {
    return route(r, 'roles.manage', async (db, c) => {
      if (id) {
        if (
          !(await db.query('SELECT 1 FROM roles WHERE organization_id=$1 AND id=$2', [c.org, id]))
            .rowCount
        )
          deny(404);
        c.canDelegate(
          (
            await db.query(
              'SELECT code FROM role_permissions WHERE organization_id=$1 AND role_id=$2',
              [c.org, id],
            )
          ).rows.map((x) => x.code),
        );
        if (
          !c.owner &&
          (
            await db.query(
              'SELECT 1 FROM membership_roles WHERE organization_id=$1 AND user_id=$2 AND role_id=$3',
              [c.org, c.actor, id],
            )
          ).rowCount
        )
          deny(403);
      }
      if (deleting) {
        await db.query('DELETE FROM roles WHERE organization_id=$1 AND id=$2', [c.org, id]);
        await c.log('role.deleted', id!);
        return { ok: true };
      }
      const input = roleSchema.parse(r.body);
      c.canDelegate(input.permissions);
      if (id) {
        await db.query(
          'UPDATE roles SET name=$3,description=$4 WHERE organization_id=$1 AND id=$2',
          [c.org, id, input.name, input.description],
        );
      } else {
        id = (
          await db.query(
            'INSERT INTO roles(organization_id,name,description) VALUES($1,$2,$3) RETURNING id',
            [c.org, input.name, input.description],
          )
        ).rows[0].id;
      }
      await db.query('DELETE FROM role_permissions WHERE organization_id=$1 AND role_id=$2', [
        c.org,
        id,
      ]);
      await db.query('INSERT INTO role_permissions SELECT $1,$2,unnest($3::text[])', [
        c.org,
        id,
        [...new Set(input.permissions)],
      ]);
      await c.log('role.saved', id!);
      return { id };
    });
  }
  app.post(base + '/roles', (r) => saveRole(r));
  app.put(base + '/roles/:id', (r) => saveRole(r, target(r)));
  app.delete(base + '/roles/:id', (r) => saveRole(r, target(r), true));
  app.put(base + '/members/:id/roles', (r) =>
    route(r, 'roles.assign', async (db, c) => {
      const id = target(r);
      await editable(db, c, id);
      const { roles } = z.strictObject({ roles: z.array(z.uuid()).max(100) }).parse(r.body);
      for (const role of new Set(roles)) {
        if (
          !(await db.query('SELECT 1 FROM roles WHERE organization_id=$1 AND id=$2', [c.org, role]))
            .rowCount
        )
          deny(404);
        c.canDelegate(
          (
            await db.query(
              'SELECT code FROM role_permissions WHERE organization_id=$1 AND role_id=$2',
              [c.org, role],
            )
          ).rows.map((x) => x.code),
        );
      }
      await db.query('DELETE FROM membership_roles WHERE organization_id=$1 AND user_id=$2', [
        c.org,
        id,
      ]);
      await db.query('INSERT INTO membership_roles SELECT $1,$2,unnest($3::uuid[])', [
        c.org,
        id,
        [...new Set(roles)],
      ]);
      await c.log('membership.roles', id);
      return { ok: true };
    }),
  );
  app.put(base + '/members/:id/status', (r) =>
    route(r, 'members.manage', async (db, c) => {
      const id = target(r);
      await editable(db, c, id);
      const { status } = z
        .strictObject({ status: z.enum(['active', 'suspended', 'revoked']) })
        .parse(r.body);
      await db.query('UPDATE memberships SET status=$3 WHERE organization_id=$1 AND user_id=$2', [
        c.org,
        id,
        status,
      ]);
      if (status === 'revoked')
        await db.query('DELETE FROM membership_roles WHERE organization_id=$1 AND user_id=$2', [
          c.org,
          id,
        ]);
      await c.log('membership.' + status, id);
      return { ok: true };
    }),
  );
  app.put(
    base + '/members/:id/owner',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    (r) =>
      route(r, undefined, async (db, c) => {
        if (!c.owner) deny(403);
        const id = target(r),
          m = await member(db, c, id);
        const body = z
          .strictObject({ owner: z.boolean(), password: z.string().max(128) })
          .parse(r.body);
        if (
          !(await matches(
            body.password,
            (await db.query('SELECT password_hash FROM users WHERE id=$1', [c.actor])).rows[0]
              .password_hash,
          ))
        )
          deny(403);
        if (m.status !== 'active') deny(409);
        if (
          m.is_owner &&
          !body.owner &&
          !(
            await db.query(
              "SELECT 1 FROM memberships WHERE organization_id=$1 AND is_owner AND status='active' AND user_id<>$2",
              [c.org, id],
            )
          ).rowCount
        )
          deny(409);
        await db.query(
          'UPDATE memberships SET is_owner=$3 WHERE organization_id=$1 AND user_id=$2',
          [c.org, id, body.owner],
        );
        await c.log(body.owner ? 'owner.granted' : 'owner.removed', id);
        return { ok: true };
      }),
  );
  app.get(base + '/invites', (r) =>
    route(
      r,
      'members.manage',
      async (db, c) =>
        (
          await db.query(
            'SELECT id,email,expires_at FROM invites WHERE organization_id=$1 AND closed_at IS NULL AND expires_at>now() ORDER BY email',
            [c.org],
          )
        ).rows,
    ),
  );
  app.delete(base + '/invites/:id', (r) =>
    route(r, 'members.manage', async (db, c) => {
      const id = target(r);
      if (
        !(
          await db.query(
            'UPDATE invites SET closed_at=now() WHERE organization_id=$1 AND id=$2 AND closed_at IS NULL',
            [c.org, id],
          )
        ).rowCount
      )
        deny(404);
      await c.log('invite.revoked', id);
      return { ok: true };
    }),
  );
  app.post(base + '/invites', async (r) => {
    const { email } = z.strictObject({ email: emailSchema }).parse(r.body);
    const value = token();
    await route(r, 'members.manage', async (db, c) => {
      await db.query(
        'UPDATE invites SET closed_at=now() WHERE organization_id=$1 AND email=$2 AND closed_at IS NULL',
        [c.org, email],
      );
      const result = await db.query(
        "INSERT INTO invites(organization_id,email,invited_by,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days') RETURNING id",
        [c.org, email, c.actor, hash(value)],
      );
      await c.log('invite.sent', result.rows[0].id);
    });
    await options.deliver(email, 'invite', value);
    return { ok: true };
  });
  app.post(
    '/auth/invites/accept',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (r) => {
      originCheck(r, options.origin);
      const input = z
        .strictObject({
          token: z.string().length(43),
          name: z.string().min(1).max(120),
          password: passwordSchema,
        })
        .parse(r.body);
      return transaction(pool, async (db) => {
        const invite = (
          await db.query(
            'SELECT * FROM invites WHERE token_hash=$1 AND expires_at>now() AND closed_at IS NULL',
            [hash(input.token)],
          )
        ).rows[0];
        if (!invite) deny(400);
        if (
          !(
            await db.query('SELECT id FROM organizations WHERE id=$1 AND active FOR UPDATE', [
              invite.organization_id,
            ])
          ).rowCount
        )
          deny(400);
        const sender = (
          await db.query(
            "SELECT m.is_owner FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND u.disabled_at IS NULL",
            [invite.organization_id, invite.invited_by],
          )
        ).rows[0];
        if (
          !sender ||
          (!sender.is_owner &&
            !(await grants(db, invite.organization_id, invite.invited_by)).includes(
              'members.manage',
            ))
        )
          deny(400);
        if (
          !(
            await db.query(
              'UPDATE invites SET closed_at=now() WHERE id=$1 AND closed_at IS NULL AND expires_at>clock_timestamp()',
              [invite.id],
            )
          ).rowCount
        )
          deny(400);
        await db.query(
          'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',
          [invite.email, input.name, await encodePassword(input.password)],
        );
        const u = (
          await db.query(
            'SELECT id,password_hash FROM users WHERE email=$1 AND disabled_at IS NULL FOR SHARE',
            [invite.email],
          )
        ).rows[0];
        if (!u || !(await matches(input.password, u.password_hash))) deny(400);
        if (
          !(
            await db.query(
              'INSERT INTO memberships(organization_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
              [invite.organization_id, u.id],
            )
          ).rowCount
        )
          deny(409);
        await audit(db, u.id, invite.organization_id, 'invite.accepted', invite.id, r.id);
        return { ok: true };
      });
    },
  );
}
