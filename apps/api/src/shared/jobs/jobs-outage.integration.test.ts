import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type QueryResultRow } from 'pg';
import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';
import { startWorker } from './index.js';

const image = 'postgres:16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8';
const runDocker = promisify(execFile);

async function docker(action: 'start' | 'stop', id: string) {
  await runDocker('docker', action === 'stop' ? ['stop', '-t', '0', id] : ['start', id], {
    windowsHide: true,
    timeout: 15_000,
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function query<T extends QueryResultRow>(
  url: string,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function until<T>(read: () => Promise<T>, valid: (value: T) => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await read();
    if (valid(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error(
    `Estado esperado não observado em ${timeoutMs} ms; último: ${JSON.stringify(last!)}`,
  );
}

async function databaseReady(url: string) {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  do {
    try {
      await query(url, 'SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } while (Date.now() < deadline);
  throw lastError;
}

describe('reinício completo de PostgreSQL descartável', () => {
  it('recupera job ativo e não duplica efeito persistido', async () => {
    await requireDisposableDatabase();
    const nonce = randomBytes(8).toString('hex');
    const port = await freePort();
    const container = await new PostgreSqlContainer(image)
      .withDatabase(`arenahub_test_${nonce}`)
      .withUsername('arenahub_test')
      .withPassword(randomBytes(24).toString('hex'))
      .withExposedPorts({ container: 5432, host: port })
      .withStartupTimeout(120_000)
      .start();
    const url = container.getConnectionUri();
    const queue = `arena.outage.${nonce}`;
    const boss = new PgBoss({
      connectionString: url,
      schema: 'arena_jobs',
      connectionTimeoutMillis: 2_000,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 1,
    });
    const errors: string[] = [];
    boss.on('error', (error) => errors.push(String(error)));
    let started: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    try {
      await query(url, 'CREATE TABLE public.job_effect (id uuid PRIMARY KEY)');
      await boss.start();
      await boss.createQueue(queue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 5 });
      await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
        const job = jobs[0];
        if (!job) throw new Error('Job ausente');
        attempts++;
        const client = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
        client.on('error', (error) => errors.push(String(error)));
        try {
          await client.connect();
          await client.query(
            'INSERT INTO public.job_effect(id) VALUES ($1) ON CONFLICT DO NOTHING',
            [job.id],
          );
          if (attempts === 1) {
            started();
            await barrier;
            await client.query('SELECT 1');
          }
        } finally {
          await client.end().catch(() => undefined);
        }
      });
      const id = await boss.send(queue, { synthetic: true });
      if (!id) throw new Error('Job não enfileirado');
      await handlerStarted;
      expect(
        (
          await query<{ total: number }>(
            url,
            'SELECT count(*)::int AS total FROM public.job_effect WHERE id=$1',
            [id],
          )
        )[0]?.total,
      ).toBe(1);
      const restoredAt = Date.now();
      await container.restart();
      expect(container.getConnectionUri()).toBe(url);
      release();
      const state = await until(
        async () =>
          (
            await query<{ state: string }>(url, 'SELECT state FROM arena_jobs.job WHERE id=$1', [
              id,
            ])
          )[0]?.state,
        (value) => value === 'completed',
        35_000,
      );
      expect(state).toBe('completed');
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(
        (
          await query<{ total: number }>(
            url,
            'SELECT count(*)::int AS total FROM public.job_effect WHERE id=$1',
            [id],
          )
        )[0]?.total,
      ).toBe(1);
      expect(Date.now() - restoredAt).toBeLessThan(35_000);
      expect(errors.length).toBeGreaterThan(0);
      console.info(`active job recovery ms: ${Date.now() - restoredAt}`);
    } finally {
      release();
      await boss.stop({ graceful: true, timeout: 5_000 }).catch(() => undefined);
      await container.stop();
    }
  }, 90_000);

  it('recupera inicialização, ociosidade e falhas repetidas; cancela shutdown', async () => {
    await requireDisposableDatabase();
    const nonce = randomBytes(8).toString('hex');
    const port = await freePort();
    const container = await new PostgreSqlContainer(image)
      .withDatabase(`arenahub_test_${nonce}`)
      .withUsername('arenahub_test')
      .withPassword(randomBytes(24).toString('hex'))
      .withExposedPorts({ container: 5432, host: port })
      .withStartupTimeout(120_000)
      .start();
    const url = container.getConnectionUri();
    const id = container.getId();
    await query(
      url,
      'CREATE SCHEMA occupancy_spike; CREATE TABLE occupancy_spike.idempotency_records (id uuid PRIMARY KEY, expires_at timestamptz NOT NULL)',
    );
    const completed: string[] = [];
    const logErrors: string[] = [];
    const logInfos: string[] = [];
    const log = {
      info: (data: unknown, message: string) => {
        logInfos.push(message);
        if (message === 'demo job completed' && data && typeof data === 'object' && 'jobId' in data)
          completed.push(String(data.jobId));
      },
      error: (_data: unknown, message: string) => {
        logErrors.push(message);
      },
    };
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    const recoveryMs: number[] = [];
    let stage = 'setup';
    try {
      stage = 'start with database down';
      await docker('stop', id);
      const startup = startWorker(url, log);
      await until(
        () => Promise.resolve(logErrors.includes('worker startup retrying')),
        Boolean,
        8_000,
      );
      await docker('start', id);
      worker = await startup;
      stage = 'initial ready';
      await until(
        () => Promise.resolve(worker!.status()),
        (state) => state === 'READY',
        15_000,
      );
      const first = await worker.boss.send('arena.demo', { synthetic: true });
      if (!first) throw new Error('Job inicial ausente');
      await until(() => Promise.resolve(completed.includes(first)), Boolean, 10_000);

      for (let cycle = 0; cycle < 2; cycle++) {
        stage = `cycle ${cycle} stop`;
        await docker('stop', id);
        stage = `cycle ${cycle} degraded`;
        await until(
          () => Promise.resolve(worker!.status()),
          (state) => state === 'DEGRADED',
          12_000,
        );
        const restoredAt = Date.now();
        stage = `cycle ${cycle} start`;
        await docker('start', id);
        stage = `cycle ${cycle} ready`;
        await until(
          () => Promise.resolve(worker!.status()),
          (state) => state === 'READY',
          15_000,
        );
        const job = await worker.boss.send('arena.demo', { synthetic: true });
        if (!job) throw new Error('Job após retorno ausente');
        await until(() => Promise.resolve(completed.includes(job)), Boolean, 10_000);
        recoveryMs.push(Date.now() - restoredAt);
        expect(worker.boss.getWipData().filter((item) => item.name === 'arena.demo')).toHaveLength(
          1,
        );
        const activity = await query<{ total: number }>(
          url,
          "SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND application_name='pgboss'",
        );
        expect(activity[0]?.total).toBeLessThanOrEqual(5);
      }
      expect(logErrors.filter((message) => message === 'worker database unavailable')).toHaveLength(
        2,
      );
      expect(
        logInfos.filter((message) => message === 'worker ready to consume jobs').length,
      ).toBeGreaterThanOrEqual(3);

      await docker('stop', id);
      stage = 'shutdown degraded';
      await until(
        () => Promise.resolve(worker!.status()),
        (state) => state === 'DEGRADED',
        12_000,
      );
      const stoppedAt = Date.now();
      stage = 'shutdown stop';
      await worker.stop();
      expect(worker.status()).toBe('STOPPED');
      expect(Date.now() - stoppedAt).toBeLessThan(20_000);
      worker = undefined;
      const controller = new AbortController();
      const pending = startWorker(url, log, { signal: controller.signal });
      await until(
        () =>
          Promise.resolve(
            logErrors.filter((message) => message === 'worker startup retrying').length >= 2,
          ),
        Boolean,
        8_000,
      );
      controller.abort();
      stage = 'shutdown cancel pending';
      await expect(pending).rejects.toThrow();
      stage = 'shutdown database restart';
      await docker('start', id);
      stage = 'shutdown connection count';
      await databaseReady(url);
      const idle = await query<{ total: number }>(
        url,
        "SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND application_name='pgboss'",
      );
      expect(idle[0]?.total).toBe(0);
      console.info(`worker recovery ms: ${recoveryMs.join(', ')}`);
    } catch (error) {
      throw new Error(`Falha em ${stage}: ${String(error)}`, { cause: error });
    } finally {
      if (worker) await worker.stop().catch(() => undefined);
      await container.stop();
    }
  }, 120_000);
});
