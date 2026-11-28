import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Client, type Pool } from 'pg';
import type WebSocket from 'ws';
import { z } from 'zod';
import { AccessError, transaction } from '../identity/core.js';
import { originCheck, session, type IdentityOptions } from '../identity/session.js';

type Subscriber = {
  socket: WebSocket;
  request: FastifyRequest;
  org: string;
  user: string;
  verifying: boolean;
  pendingEvent: string | undefined;
  timer?: ReturnType<typeof setInterval>;
};

export function registerRealtimePlugin(app: FastifyInstance) {
  void app.register(websocket, { options: { maxPayload: 1024 } });
}

export function realtimeRoutes(
  app: FastifyInstance,
  pool: Pool,
  databaseUrl: string,
  options: IdentityOptions,
) {
  const subscribers = new Set<Subscriber>();
  const validated = new WeakMap<FastifyRequest, { org: string; user: string }>();
  let listener: Client | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let attempts = 0;

  async function authorized(request: FastifyRequest, org: string, user: string) {
    try {
      return await transaction(pool, async (db) => {
        const s = await session(db, request, options.origin);
        if (s.user_id !== user) return false;
        const row = (
          await db.query<{ is_owner: boolean }>(
            "SELECT is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
            [org, user],
          )
        ).rows[0];
        if (!row) return false;
        return (
          row.is_owner ||
          !!(
            await db.query(
              'SELECT 1 FROM membership_roles mr JOIN role_permissions rp USING(organization_id,role_id) WHERE mr.organization_id=$1 AND mr.user_id=$2 AND rp.code=$3 LIMIT 1',
              [org, user, 'reservations.read'],
            )
          ).rowCount
        );
      });
    } catch {
      return false;
    }
  }
  async function verifyAndSend(sub: Subscriber, event?: string) {
    if (sub.socket.readyState !== sub.socket.OPEN) return;
    if (sub.verifying) {
      if (event) sub.pendingEvent = event;
      return;
    }
    sub.verifying = true;
    try {
      if (!(await authorized(sub.request, sub.org, sub.user))) {
        sub.socket.close(1008, 'Acesso encerrado');
        return;
      }
      if (event && sub.socket.readyState === sub.socket.OPEN)
        sub.socket.send(JSON.stringify({ type: 'agenda.invalidate', kind: event }));
    } finally {
      sub.verifying = false;
      const pending = sub.pendingEvent;
      sub.pendingEvent = undefined;
      if (pending) void verifyAndSend(sub, pending);
    }
  }
  function onNotification(message: string | undefined) {
    if (!message || message.length > 512) return;
    let payload: { org?: string; kind?: string };
    try {
      payload = JSON.parse(message) as { org?: string; kind?: string };
    } catch {
      return;
    }
    if (
      !payload.org ||
      !payload.kind ||
      !z.uuid().safeParse(payload.org).success ||
      !/^(reservation|block|recurrence)\.[a-z]+$/.test(payload.kind)
    )
      return;
    for (const sub of subscribers)
      if (sub.org === payload.org) void verifyAndSend(sub, payload.kind);
  }
  function scheduleReconnect() {
    if (closing || retry) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, delay);
    retry.unref();
  }
  async function connect() {
    if (closing || listener) return;
    const client = new Client({
      connectionString: databaseUrl,
      application_name: 'arenahub-agenda-listener',
      connectionTimeoutMillis: 2_000,
    });
    listener = client;
    let failed = false;
    const fail = (error?: Error & { code?: string }) => {
      if (failed) return;
      failed = true;
      if (listener === client) listener = undefined;
      if (!closing) app.log.error({ code: error?.code }, 'agenda listener disconnected');
      void client.end().catch(() => undefined);
      scheduleReconnect();
    };
    client.on('error', fail);
    client.on('end', () => fail());
    client.on('notification', (message) => {
      if (message.channel === 'arenahub_agenda') onNotification(message.payload);
    });
    try {
      await client.connect();
      await client.query('LISTEN arenahub_agenda');
      if (attempts > 0)
        for (const sub of subscribers) void verifyAndSend(sub, 'listener.reconnected');
      attempts = 0;
    } catch (error) {
      fail(error as Error & { code?: string });
    }
  }
  app.addHook('onReady', async () => {
    await connect();
  });
  app.addHook('onClose', async () => {
    closing = true;
    if (retry) clearTimeout(retry);
    for (const sub of subscribers) {
      if (sub.timer) clearInterval(sub.timer);
      sub.socket.close(1001, 'Servidor encerrado');
    }
    subscribers.clear();
    await listener?.end().catch(() => undefined);
    listener = undefined;
  });
  app.get(
    '/orgs/:slug/agenda/stream',
    {
      websocket: true,
      preValidation: async (request) => {
        originCheck(request, options.origin);
        const slug = z.object({ slug: z.string().max(80) }).parse(request.params).slug;
        const identity = await transaction(pool, async (db) => {
          const s = await session(db, request, options.origin);
          const org = (
            await db.query<{ id: string }>(
              'SELECT id FROM organizations WHERE slug=$1 AND active',
              [slug],
            )
          ).rows[0]?.id;
          if (
            !org ||
            (options.hostOrganization?.(request) && options.hostOrganization(request) !== org)
          )
            throw new AccessError(404, 'NOT_FOUND');
          const member = (
            await db.query<{ is_owner: boolean }>(
              "SELECT is_owner FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
              [org, s.user_id],
            )
          ).rows[0];
          if (!member) throw new AccessError(404, 'NOT_FOUND');
          if (
            !member.is_owner &&
            !(
              await db.query(
                'SELECT 1 FROM membership_roles mr JOIN role_permissions rp USING(organization_id,role_id) WHERE mr.organization_id=$1 AND mr.user_id=$2 AND rp.code=$3 LIMIT 1',
                [org, s.user_id, 'reservations.read'],
              )
            ).rowCount
          )
            throw new AccessError(403, 'FORBIDDEN');
          return { org, user: s.user_id };
        });
        validated.set(request, identity);
      },
    },
    (socket, request) => {
      const identity = validated.get(request);
      if (!identity) {
        socket.close(1008);
        return;
      }
      const sub: Subscriber = {
        socket,
        request,
        org: identity.org,
        user: identity.user,
        verifying: false,
        pendingEvent: undefined,
      };
      sub.timer = setInterval(() => {
        void verifyAndSend(sub);
      }, 30_000);
      sub.timer.unref();
      subscribers.add(sub);
      socket.send(JSON.stringify({ type: 'agenda.connected' }));
      socket.on('message', () => socket.close(1008, 'Canal somente leitura'));
      socket.on('close', () => {
        if (sub.timer) clearInterval(sub.timer);
        subscribers.delete(sub);
      });
      socket.on('error', () => {
        if (sub.timer) clearInterval(sub.timer);
        subscribers.delete(sub);
      });
    },
  );
}
