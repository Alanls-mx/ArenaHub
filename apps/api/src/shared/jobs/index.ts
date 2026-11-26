import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { cleanExpiredIdempotency } from '../idempotency/index.js';

export const demoQueue = 'arena.demo';
export const cleanupQueue = 'idempotency.cleanup';

export async function startWorker(
  databaseUrl: string,
  log: {
    info: (data: unknown, message: string) => void;
    error: (data: unknown, message: string) => void;
  },
) {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs', max: 5 });
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_000 });
  boss.on('error', (error) => log.error({ err: error }, 'job queue error'));
  try {
    await boss.start();
    await boss.createQueue(demoQueue);
    await boss.createQueue(cleanupQueue);
    await boss.work(demoQueue, async (jobs) => {
      for (const job of jobs) log.info({ jobId: job.id }, 'demo job completed');
    });
    await boss.work(cleanupQueue, async () => {
      const deleted = await cleanExpiredIdempotency(pool);
      log.info({ deleted }, 'expired idempotency records removed');
    });
    await boss.schedule(cleanupQueue, '0 * * * *');
    return {
      boss,
      async stop() {
        try {
          await boss.stop({ graceful: true, timeout: 15_000 });
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    await boss.stop().catch(() => undefined);
    await pool.end();
    throw error;
  }
}
