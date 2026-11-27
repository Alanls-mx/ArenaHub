import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
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
});
