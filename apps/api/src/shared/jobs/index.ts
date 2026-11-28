import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { generateRecurrences } from '../../booking/generate.js';
import { cleanExpiredIdempotency } from '../idempotency/index.js';

export const demoQueue = 'arena.demo';
export const cleanupQueue = 'idempotency.cleanup';
export const recurrenceQueue = 'recurrences.generate';
export type WorkerStatus =
  'INITIALIZING' | 'READY' | 'DEGRADED' | 'RECOVERING' | 'STOPPING' | 'STOPPED';

export async function startWorker(
  databaseUrl: string,
  log: {
    info: (data: unknown, message: string) => void;
    error: (data: unknown, message: string) => void;
  },
  options: { signal?: AbortSignal; startAttempts?: number } = {},
) {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'arena_jobs',
    max: 5,
    connectionTimeoutMillis: 2_000,
  });
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'arenahub-worker-cleanup',
    max: 2,
    connectionTimeoutMillis: 2_000,
  });
  let state: WorkerStatus = 'INITIALIZING';
  let monitor: ReturnType<typeof setInterval> | undefined;
  let lastFailure = 0;
  let lastErrorCode: string | undefined;
  pool.on('error', (error: Error & { code?: string }) => {
    lastFailure = Date.now();
    lastErrorCode = error.code;
    log.error({ code: error.code }, 'idle PostgreSQL cleanup connection failed');
  });
  const onAbort = () => {
    void boss.stop({ graceful: false, timeout: 1_000 }).catch(() => undefined);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  boss.on('error', (error: Error & { code?: string }) => {
    lastFailure = Date.now();
    lastErrorCode = error.code;
  });
  boss.on('warning', (warning) => {
    if (warning.data && 'type' in warning.data && warning.data.type === 'start_retry')
      log.error({ code: 'START_RETRY' }, 'worker startup retrying');
  });
  const refreshState = () => {
    if (state === 'STOPPING' || state === 'STOPPED') return state;
    const now = Date.now();
    const workers = boss
      .getWipData()
      .filter((worker) => [demoQueue, cleanupQueue, recurrenceQueue].includes(worker.name));
    const ready =
      workers.length === 3 &&
      workers.every(
        (worker) =>
          worker.state === 'active' &&
          worker.lastFetchedOn !== null &&
          now - worker.lastFetchedOn < 10_000 &&
          worker.lastFetchedOn > Math.max(worker.lastErrorOn ?? 0, lastFailure),
      );
    const recovered = workers.some(
      (worker) => worker.lastFetchedOn !== null && worker.lastFetchedOn > lastFailure,
    );
    const next: WorkerStatus = ready
      ? 'READY'
      : lastFailure > 0 || workers.some((worker) => worker.lastErrorOn !== null)
        ? recovered
          ? 'RECOVERING'
          : 'DEGRADED'
        : 'INITIALIZING';
    if (next !== state) {
      state = next;
      if (next === 'DEGRADED') log.error({ code: lastErrorCode }, 'worker database unavailable');
      else if (next === 'READY') log.info({}, 'worker ready to consume jobs');
      else log.info({}, `worker ${next.toLowerCase()}`);
    }
    return state;
  };
  try {
    if (options.signal?.aborted) throw new Error('Worker startup cancelled');
    await boss.start({ attempts: options.startAttempts ?? 10_000 });
    if (options.signal?.aborted) throw new Error('Worker startup cancelled');
    await boss.createQueue(demoQueue);
    await boss.createQueue(cleanupQueue);
    await boss.createQueue(recurrenceQueue);
    const initiallyDeleted = await cleanExpiredIdempotency(pool);
    log.info({ deleted: initiallyDeleted }, 'startup idempotency cleanup completed');
    await boss.work(demoQueue, async (jobs) => {
      for (const job of jobs) log.info({ jobId: job.id }, 'demo job completed');
    });
    await boss.work(cleanupQueue, async () => {
      const deleted = await cleanExpiredIdempotency(pool);
      await pool.query('DELETE FROM arena_identity.idempotency_keys WHERE expires_at<=now()');
      log.info({ deleted }, 'expired idempotency records removed');
    });
    await boss.work(recurrenceQueue, async () => {
      const result = await generateRecurrences(pool);
      log.info(result, 'recurrence horizon materialized');
    });
    await boss.schedule(cleanupQueue, '0 * * * *');
    await boss.schedule(recurrenceQueue, '0 * * * *');
    monitor = setInterval(refreshState, 1_000);
    monitor.unref();
    return {
      boss,
      status: refreshState,
      async stop() {
        state = 'STOPPING';
        if (monitor) clearInterval(monitor);
        try {
          await boss.stop({ graceful: true, timeout: 15_000 });
        } finally {
          await pool.end();
          state = 'STOPPED';
        }
      },
    };
  } catch (error) {
    if (monitor) clearInterval(monitor);
    await boss.stop().catch(() => undefined);
    await pool.end();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
