import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { requireDisposableDatabase } from '../__tests__/disposable-database.js';
import { buildApp } from '../app.js';
import { provision } from '../identity/provision.js';

const image = 'postgres:16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8';
const migrations = [
  '20261126201305_occupancy_spike',
  '20261126203000_align_occupancy_fk',
  '20261126210000_idempotency_spike',
  '20261127010000_identity',
  '20261127011000_organization_settings',
  '20261127012000_owner_integrity',
  '20261127013000_organization_domains',
  '20261127014000_operational_structure',
  '20261127015000_booking_engine',
];
const runDocker = promisify(execFile);
const origin = 'http://localhost:3000';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function until(read: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(label);
}

describe('recuperação do WebSocket da Fase 4', () => {
  it('ressincroniza após parada total e restauração do PostgreSQL no mesmo endereço', async () => {
    await requireDisposableDatabase();
    const dbPort = await freePort();
    const nonce = randomBytes(8).toString('hex');
    const container = await new PostgreSqlContainer(image)
      .withDatabase(`arenahub_test_${nonce}`)
      .withUsername('arenahub_test')
      .withPassword(randomBytes(24).toString('hex'))
      .withExposedPorts({ container: 5432, host: dbPort })
      .withStartupTimeout(120_000)
      .start();
    const url = container.getConnectionUri();
    expect(Number(new URL(url).port)).toBe(dbPort);
    const docker = (action: 'stop' | 'start') =>
      runDocker(
        'docker',
        action === 'stop' ? ['stop', '-t', '0', container.getId()] : ['start', container.getId()],
        { windowsHide: true, timeout: 15_000 },
      );
    let app: ReturnType<typeof buildApp> | undefined;
    let stream: WebSocket | undefined;
    let stopped = false;
    try {
      const admin = new Client({ connectionString: url });
      try {
        await admin.connect();
        await admin.query('CREATE SCHEMA occupancy_spike');
        await admin.query('SET search_path TO occupancy_spike,public');
        for (const migration of migrations) {
          const sql = await readFile(
            new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
            'utf8',
          );
          await admin.query(sql);
        }
      } finally {
        await admin.end().catch(() => undefined);
      }
      const slug = 'realtime-' + randomUUID();
      const email = `${slug}@example.org`;
      const password = randomUUID();
      const setup = new Pool({ connectionString: url });
      try {
        await provision(setup, {
          slug,
          name: 'Arena de teste',
          ownerName: 'Owner',
          email,
          password,
        });
      } finally {
        await setup.end();
      }
      app = buildApp({ databaseUrl: url, logLevel: 'silent', deliver: async () => {} });
      await app.listen({ host: '127.0.0.1', port: 0 });
      const apiPort = (app.server.address() as AddressInfo).port;
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin },
        payload: { email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const messages: { type: string; kind?: string }[] = [];
      const socketEvents: number[] = [];
      stream = new WebSocket(`ws://localhost:${apiPort}/api/v1/orgs/${slug}/agenda/stream`, {
        headers: { origin, cookie },
      });
      stream.on('message', (data) => messages.push(JSON.parse(data.toString())));
      stream.on('close', (code) => socketEvents.push(code));
      await until(() => messages.some((x) => x.type === 'agenda.connected'), 'Handshake ausente');
      const ready = () => app!.inject({ method: 'GET', url: '/api/v1/health/ready' });
      expect((await ready()).statusCode).toBe(200);
      await docker('stop');
      stopped = true;
      await until(async () => (await ready()).statusCode === 503, 'Outage não observado');
      expect(stream.readyState).toBe(WebSocket.OPEN);
      await docker('start');
      stopped = false;
      const published = await runDocker('docker', ['port', container.getId(), '5432/tcp'], {
        windowsHide: true,
        timeout: 10_000,
      });
      expect(published.stdout).toContain(`:${dbPort}`);
      await until(async () => (await ready()).statusCode === 200, 'Readiness não recuperou');
      await until(
        () => messages.some((x) => x.kind === 'listener.reconnected'),
        `Listener não reconectou; socket=${stream.readyState}; closes=${socketEvents.join(',')}`,
      );
      expect(stream.readyState).toBe(WebSocket.OPEN);
      const date = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
      const agenda = () =>
        app!.inject({
          method: 'GET',
          url: `/api/v1/orgs/${slug}/agenda?from=${date}&to=${date}`,
          headers: { origin, cookie },
        });
      expect((await agenda()).statusCode).toBe(200);
      const notifier = new Client({ connectionString: url });
      try {
        await notifier.connect();
        await notifier.query('SELECT pg_notify($1,$2)', [
          'arenahub_agenda',
          JSON.stringify({
            org: (
              await notifier.query('SELECT id FROM arena_identity.organizations WHERE slug=$1', [
                slug,
              ])
            ).rows[0].id,
            kind: 'reservation.changed',
          }),
        ]);
      } finally {
        await notifier.end();
      }
      await until(
        () => messages.some((x) => x.kind === 'reservation.changed'),
        'Nova invalidação não chegou',
      );
      expect((await agenda()).statusCode).toBe(200);
      expect(socketEvents).toEqual([]);
    } finally {
      if (stopped) await docker('start').catch(() => undefined);
      stream?.close();
      await app?.close();
      await container.stop();
    }
  }, 120_000);
});
