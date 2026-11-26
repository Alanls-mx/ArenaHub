import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';
import { demoQueue, startWorker } from './index.js';

let worker: Awaited<ReturnType<typeof startWorker>>;
let databaseUrl: string;
const completed: string[] = [];

beforeAll(async () => {
  databaseUrl = await requireDisposableDatabase();
  worker = await startWorker(databaseUrl, {
    info: (data, message) => {
      if (message === 'demo job completed' && data && typeof data === 'object' && 'jobId' in data) {
        completed.push(String(data.jobId));
      }
    },
    error: () => undefined,
  });
}, 30_000);

afterAll(async () => {
  await worker?.stop();
}, 30_000);

describe('worker PostgreSQL', () => {
  it('falha na inicialização quando PostgreSQL está indisponível', async () => {
    await expect(
      startWorker('postgresql://unused:unused@127.0.0.1:1/unused', {
        info: () => undefined,
        error: () => undefined,
      }),
    ).rejects.toThrow();
  }, 15_000);

  it('persiste e executa job sintético', async () => {
    const id = await worker.boss.send(demoQueue, { synthetic: true });
    expect(id).toBeTruthy();
    for (let attempt = 0; attempt < 100 && !completed.includes(String(id)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(completed).toContain(id);
  }, 15_000);

  it('recupera job pendente após reinicialização e respeita chave singleton', async () => {
    const queue = 'arena.recovery';
    const producer = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' });
    await producer.start();
    await producer.createQueue(queue);
    const id = await producer.send(
      queue,
      { synthetic: true },
      { singletonKey: 'one', singletonSeconds: 60 },
    );
    expect(id).toBeTruthy();
    expect(
      await producer.send(
        queue,
        { synthetic: true },
        { singletonKey: 'one', singletonSeconds: 60 },
      ),
    ).toBeNull();
    await producer.stop();

    const restarted = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' });
    try {
      await restarted.start();
      let completedId: string | undefined;
      await restarted.work(queue, async (jobs) => {
        completedId = jobs[0]?.id;
      });
      for (let attempt = 0; attempt < 100 && !completedId; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(completedId).toBe(id);
    } finally {
      await restarted.stop();
    }
  }, 20_000);

  it('retenta falha controlada e conclui na segunda tentativa', async () => {
    const queue = 'arena.retry';
    const boss = new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' });
    let attempts = 0;
    try {
      await boss.start();
      await boss.createQueue(queue);
      await boss.work(queue, async () => {
        attempts++;
        if (attempts === 1) throw new Error('falha sintética');
      });
      const id = await boss.send(
        queue,
        { synthetic: true },
        { retryLimit: 1, retryDelay: 1, retryBackoff: true },
      );
      expect(id).toBeTruthy();
      for (let attempt = 0; attempt < 120 && attempts < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(attempts).toBe(2);
    } finally {
      await boss.stop();
    }
  }, 20_000);

  it('dois workers concorrentes não duplicam jobs sintéticos', async () => {
    const queue = 'arena.concurrent';
    const bosses = [
      new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' }),
      new PgBoss({ connectionString: databaseUrl, schema: 'arena_jobs' }),
    ];
    const seen: string[] = [];
    try {
      await Promise.all(bosses.map((boss) => boss.start()));
      await bosses[0]!.createQueue(queue);
      await Promise.all(
        bosses.map((boss) =>
          boss.work(queue, async (jobs) => {
            seen.push(...jobs.map((job) => job.id));
          }),
        ),
      );
      const ids = await Promise.all(
        Array.from({ length: 6 }, (_, index) => bosses[0]!.send(queue, { synthetic: index })),
      );
      for (let attempt = 0; attempt < 100 && seen.length < ids.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(seen.length).toBe(ids.length);
      expect(new Set(seen).size).toBe(ids.length);
    } finally {
      await Promise.all(bosses.map((boss) => boss.stop()));
    }
  }, 20_000);
});
