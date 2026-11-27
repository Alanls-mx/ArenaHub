import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';

const image = 'postgres:16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8';
const apiDir = fileURLToPath(new URL('../../../', import.meta.url));
let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let apiPort: number;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function until<T>(read: () => Promise<T>, valid: (value: T) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await read();
    if (valid(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error(`Expected state not observed: ${JSON.stringify(last!)}`);
}

function start(entry: 'server' | 'worker', extraEnv: Record<string, string> = {}) {
  const logs: string[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', `src/${entry}.ts`], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl,
      API_PORT: String(apiPort),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const append = (data: Buffer) => logs.push(data.toString('utf8'));
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    logs,
    get exit() {
      return exit;
    },
  };
}

type Runtime = ReturnType<typeof start>;

async function stop(runtime: Runtime) {
  if (runtime.exit) return;
  const child: ChildProcess = runtime.child;
  child.kill('SIGTERM');
  await until(
    () => Promise.resolve(runtime.exit),
    (exit) => exit !== undefined,
    20_000,
  );
}

async function docker(action: 'start' | 'stop', id: string) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('docker', action === 'stop' ? ['stop', '-t', '0', id] : ['start', id], {
    windowsHide: true,
    timeout: 15_000,
  });
}

async function readiness(): Promise<number> {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/health/ready`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  await requireDisposableDatabase();
  const nonce = randomBytes(8).toString('hex');
  apiPort = await freePort();
  const dbPort = await freePort();
  container = await new PostgreSqlContainer(image)
    .withDatabase(`arenahub_test_${nonce}`)
    .withUsername('arenahub_test')
    .withPassword(randomBytes(24).toString('hex'))
    .withExposedPorts({ container: 5432, host: dbPort })
    .withStartupTimeout(120_000)
    .start();
  databaseUrl = container.getConnectionUri();
  const migrationDirs = [
    '20261126201305_occupancy_spike',
    '20261126203000_align_occupancy_fk',
    '20261126210000_idempotency_spike',
  ];
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query('CREATE SCHEMA occupancy_spike');
    await admin.query('SET search_path TO occupancy_spike');
    for (const migration of migrationDirs) {
      const sql = await readFile(
        new URL(`../../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
        'utf8',
      );
      await admin.query(sql);
    }
  } finally {
    await admin.end();
  }
}, 120_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe('real runtime PostgreSQL outage', () => {
  it('API survives an idle readiness connection and recovers', async () => {
    const api = start('server');
    try {
      await until(readiness, (status) => status === 200);
      const idle = await query<{ total: number }>(
        "SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND state='idle' AND application_name='arenahub-api-readiness'",
      );
      expect(idle[0]?.total).toBeGreaterThanOrEqual(1);
      await container.restart();
      expect(container.getConnectionUri()).toBe(databaseUrl);
      expect(api.exit, api.logs.join('')).toBeUndefined();
      await until(readiness, (status) => status === 200);
      expect(api.exit).toBeUndefined();
    } finally {
      await stop(api);
    }
  }, 90_000);

  it('worker real sobrevê pool de limpeza ocioso, retoma jobs sem duplicação', async () => {
    const worker = start('worker');
    const producer = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' });
    const producerErrors: string[] = [];
    producer.on('error', (error) => producerErrors.push(error.message));
    try {
      await producer.start();
      await until(() => {
        if (worker.exit) throw new Error(`worker exit: ${worker.logs.join('')}`);
        return Promise.resolve(
          worker.logs.join('').includes('startup idempotency cleanup completed'),
        );
      }, Boolean);
      await until(
        () => Promise.resolve(worker.logs.join('').includes('worker ready to consume jobs')),
        Boolean,
      );
      const idle = await query<{ total: number }>(
        "SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND state='idle' AND application_name='arenahub-worker-cleanup'",
      );
      expect(idle[0]?.total).toBeGreaterThanOrEqual(1);
      const first = await producer.send('arena.demo', { synthetic: true });
      expect(first).toBeTruthy();
      await until(() => Promise.resolve(worker.logs.join('').includes(String(first))), Boolean);

      await docker('stop', container.getId());
      await until(
        () =>
          Promise.resolve(
            worker.logs.join('').includes('idle PostgreSQL cleanup connection failed'),
          ),
        Boolean,
      );
      expect(worker.exit, worker.logs.join('')).toBeUndefined();
      await docker('start', container.getId());
      await until(
        () =>
          Promise.resolve(worker.logs.join('').split('worker ready to consume jobs').length - 1),
        (readyTransitions) => readyTransitions >= 2,
      );
      const second = await producer.send('arena.demo', { synthetic: true });
      expect(second).toBeTruthy();
      await until(() => Promise.resolve(worker.logs.join('').includes(String(second))), Boolean);
      expect(worker.logs.join('').split(String(first)).length - 1).toBe(1);
      expect(worker.logs.join('').split(String(second)).length - 1).toBe(1);
      expect(producerErrors.length).toBeGreaterThan(0);
    } finally {
      await producer.stop().catch(() => undefined);
      await stop(worker);
    }
  }, 120_000);

  it('API e worker reais recuperam simultaneamente; shutdown durante outage termina', async () => {
    const api = start('server');
    const worker = start('worker');
    const producer = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' });
    producer.on('error', () => undefined);
    try {
      await producer.start();
      await until(readiness, (status) => status === 200);
      await until(() => {
        if (worker.exit) throw new Error(`worker exit: ${worker.logs.join('')}`);
        return Promise.resolve(
          worker.logs.join('').includes('startup idempotency cleanup completed'),
        );
      }, Boolean);
      await docker('stop', container.getId());
      await until(readiness, (status) => status === 503);
      await until(
        () =>
          Promise.resolve(
            worker.logs.join('').includes('idle PostgreSQL cleanup connection failed'),
          ),
        Boolean,
      );
      expect(api.exit).toBeUndefined();
      expect(worker.exit).toBeUndefined();
      await docker('start', container.getId());
      await until(readiness, (status) => status === 200);
      const recoveredJob = await producer.send('arena.demo', { synthetic: true });
      expect(recoveredJob).toBeTruthy();
      await until(
        () => Promise.resolve(worker.logs.join('').includes(String(recoveredJob))),
        Boolean,
      );
      await producer.stop();
      await docker('stop', container.getId());
      await until(readiness, (status) => status === 503);
      const stoppedAt = Date.now();
      await stop(api);
      await stop(worker);
      expect(Date.now() - stoppedAt).toBeLessThan(20_000);
      expect(api.exit).toBeDefined();
      expect(worker.exit).toBeDefined();
      await docker('start', container.getId());
      await until(
        () => Promise.resolve(api.exit),
        (exit) => exit !== undefined,
      );
      await until(
        () => Promise.resolve(worker.exit),
        (exit) => exit !== undefined,
      );
    } finally {
      await producer.stop().catch(() => undefined);
      if (!api.exit) await stop(api);
      if (!worker.exit) await stop(worker);
      await docker('start', container.getId()).catch(() => undefined);
    }
  }, 120_000);
});
