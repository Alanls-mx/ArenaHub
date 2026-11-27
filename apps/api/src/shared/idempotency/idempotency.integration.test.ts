import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';
import { cleanExpiredIdempotency, executeIdempotent, type IdempotencyInput } from './index.js';

const org = randomUUID();
const otherOrg = randomUUID();
const user = randomUUID();
let pool: Pool;
let ready = false;

async function waitForContender(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock'
         AND query LIKE 'INSERT INTO occupancy_spike.idempotency_records%'`,
    );
    if ((result.rows[0]?.total ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Concorrente não chegou ao lock');
}

function input(overrides: Partial<IdempotencyInput> = {}): IdempotencyInput {
  return {
    organizationId: org,
    userId: user,
    key: randomUUID(),
    method: 'POST',
    route: '/api/v1/test/:id',
    pathParams: { id: 'one' },
    body: { a: 1, b: 2 },
    ...overrides,
  };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: await requireDisposableDatabase(), max: 5 });
  await pool.query('CREATE TABLE occupancy_spike.idempotency_effects (id uuid PRIMARY KEY)');
  ready = true;
});

afterAll(async () => {
  if (ready) await pool.query('DROP TABLE occupancy_spike.idempotency_effects');
  await pool?.end();
});

describe('idempotência transacional', () => {
  it('reapresenta a resposta sem repetir efeito, com corpo normalizado', async () => {
    const request = input();
    const effectId = randomUUID();
    const effect = async (client: import('pg').PoolClient) => {
      await client.query('INSERT INTO occupancy_spike.idempotency_effects (id) VALUES ($1)', [
        effectId,
      ]);
      return { status: 201, body: { created: true } };
    };
    expect(await executeIdempotent(pool, request, effect)).toEqual({
      status: 201,
      body: { created: true },
    });
    expect(await executeIdempotent(pool, { ...request, body: { b: 2, a: 1 } }, effect)).toEqual({
      status: 201,
      body: { created: true },
    });
    const count = await pool.query(
      'SELECT count(*)::int AS total FROM occupancy_spike.idempotency_effects WHERE id=$1',
      [effectId],
    );
    expect(count.rows[0].total).toBe(1);
    await expect(
      executeIdempotent(pool, { ...request, body: { a: 3 } }, effect),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      executeIdempotent(pool, { ...request, route: '/api/v1/other' }, effect),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      executeIdempotent(pool, { ...request, method: 'PATCH' }, effect),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      executeIdempotent(pool, { ...request, pathParams: { id: 'two' } }, effect),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('isola a mesma chave entre organizações e usuários', async () => {
    const request = input();
    const effect = async () => ({ status: 200, body: { ok: true } });
    await executeIdempotent(pool, request, effect);
    await executeIdempotent(pool, { ...request, organizationId: otherOrg }, effect);
    await executeIdempotent(pool, { ...request, userId: randomUUID() }, effect);
    const count = await pool.query(
      'SELECT count(*)::int AS total FROM occupancy_spike.idempotency_records WHERE key=$1',
      [request.key],
    );
    expect(count.rows[0].total).toBe(3);
  });

  it('reverte chave e efeito quando a transação falha', async () => {
    const request = input();
    const effectId = randomUUID();
    await expect(
      executeIdempotent(pool, request, async (client) => {
        await client.query('INSERT INTO occupancy_spike.idempotency_effects (id) VALUES ($1)', [
          effectId,
        ]);
        throw new Error('falha sintética');
      }),
    ).rejects.toThrow('falha sintética');
    expect(
      await executeIdempotent(pool, request, async (client) => {
        await client.query('INSERT INTO occupancy_spike.idempotency_effects (id) VALUES ($1)', [
          effectId,
        ]);
        return { status: 200, body: { ok: true } };
      }),
    ).toMatchObject({ status: 200 });
  });

  it('duas conexões recebem a mesma resposta com apenas um efeito', async () => {
    const request = input();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let effects = 0;
    const first = executeIdempotent(pool, request, async () => {
      effects++;
      entered();
      await barrier;
      return { status: 201, body: { sequence: effects } };
    });
    await started;
    const second = executeIdempotent(pool, request, async () => {
      effects++;
      return { status: 201, body: { sequence: effects } };
    });
    try {
      await waitForContender();
    } finally {
      release();
    }
    expect(await Promise.all([first, second])).toEqual([
      { status: 201, body: { sequence: 1 } },
      { status: 201, body: { sequence: 1 } },
    ]);
    expect(effects).toBe(1);
  });

  it('limita a espera de concorrente sem deixar chave bloqueada', async () => {
    const request = input();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = executeIdempotent(pool, request, async () => {
      entered();
      await barrier;
      return { status: 200, body: { ok: true } };
    });
    await started;
    try {
      await expect(
        executeIdempotent(pool, request, async () => ({ status: 201, body: {} })),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    } finally {
      release();
    }
    await first;
    expect(
      await executeIdempotent(pool, request, async () => ({ status: 201, body: {} })),
    ).toMatchObject({ status: 200 });
  }, 10_000);

  it('recusa chave inválida e remove expiradas', async () => {
    await expect(
      executeIdempotent(pool, input({ key: 'invalid' }), async () => ({ status: 200, body: {} })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const request = input();
    await executeIdempotent(pool, request, async () => ({ status: 200, body: {} }));
    await pool.query(
      "UPDATE occupancy_spike.idempotency_records SET created_at=now() - interval '2 days', expires_at=now() - interval '1 day' WHERE key=$1",
      [request.key],
    );
    expect(await cleanExpiredIdempotency(pool)).toBeGreaterThanOrEqual(1);
  });

  it('falha no armazenamento da resposta reverte efeito e chave', async () => {
    const request = input();
    const effectId = randomUUID();
    await pool.query(`CREATE FUNCTION occupancy_spike.fail_idempotency_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $$`);
    await pool.query(`CREATE TRIGGER fail_idempotency_update BEFORE UPDATE
      ON occupancy_spike.idempotency_records FOR EACH ROW
      EXECUTE FUNCTION occupancy_spike.fail_idempotency_update()`);
    try {
      await expect(
        executeIdempotent(pool, request, async (client) => {
          await client.query('INSERT INTO occupancy_spike.idempotency_effects (id) VALUES ($1)', [
            effectId,
          ]);
          return { status: 201, body: { ok: true } };
        }),
      ).rejects.toMatchObject({ code: 'P0001' });
      const effect = await pool.query(
        'SELECT id FROM occupancy_spike.idempotency_effects WHERE id=$1',
        [effectId],
      );
      const key = await pool.query(
        'SELECT id FROM occupancy_spike.idempotency_records WHERE key=$1',
        [request.key],
      );
      expect(effect.rowCount).toBe(0);
      expect(key.rowCount).toBe(0);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_idempotency_update ON occupancy_spike.idempotency_records',
      );
      await pool.query('DROP FUNCTION occupancy_spike.fail_idempotency_update()');
    }
  });
});
