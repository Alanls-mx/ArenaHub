import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';

describe('perda de conexão durante job', () => {
  it('retenta após término forçado da conexão do handler sem duplicar efeito', async () => {
    const url = await requireDisposableDatabase();
    const queue = `arena.interrupted.${randomUUID().replaceAll('-', '')}`;
    const boss = new PgBoss({ connectionString: url, schema: 'arena_jobs' });
    const admin = new Client({ connectionString: url });
    let attempts = 0;
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (pid: number) => void = () => undefined;
    const started = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const connectionErrors: unknown[] = [];
    let handlerFailures = 0;
    try {
      await admin.connect();
      await admin.query('CREATE TABLE occupancy_spike.job_recovery_effects (id uuid PRIMARY KEY)');
      boss.on('error', (error) => connectionErrors.push(error));
      await boss.start();
      await boss.createQueue(queue);
      await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
        const job = jobs[0];
        if (!job) throw new Error('Job ausente');
        attempts++;
        const client = new Client({ connectionString: url });
        client.on('error', (error) => connectionErrors.push(error));
        try {
          await client.connect();
          const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
            .rows[0]?.pid;
          if (!pid) throw new Error('PID ausente');
          await client.query(
            `INSERT INTO occupancy_spike.job_recovery_effects (id)
            VALUES ($1) ON CONFLICT DO NOTHING`,
            [job.id],
          );
          if (attempts === 1) {
            entered(pid);
            await barrier;
            await client.query('SELECT 1');
          }
        } catch (error) {
          handlerFailures++;
          throw error;
        } finally {
          await client.end().catch(() => undefined);
        }
      });
      const id = await boss.send(queue, { synthetic: true }, { retryLimit: 1, retryDelay: 1 });
      if (!id) throw new Error('Job não foi enfileirado');
      const pid = await started;
      expect(
        (
          await admin.query<{ terminated: boolean }>(
            'SELECT pg_terminate_backend($1) AS terminated',
            [pid],
          )
        ).rows[0]?.terminated,
      ).toBe(true);
      release();
      let state: string | undefined;
      for (let attempt = 0; attempt < 100 && state !== 'completed'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = (
          await admin.query<{ state: string }>('SELECT state FROM arena_jobs.job WHERE id=$1', [id])
        ).rows[0]?.state;
      }
      expect(state).toBe('completed');
      expect(attempts).toBe(2);
      const effect = await admin.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM occupancy_spike.job_recovery_effects WHERE id=$1',
        [id],
      );
      expect(effect.rows[0]?.total).toBe(1);
      expect(handlerFailures).toBe(1);
    } finally {
      release();
      await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
      await admin
        .query('DROP TABLE IF EXISTS occupancy_spike.job_recovery_effects')
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }, 25_000);
});
