import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from './disposable-database.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error('Use pnpm test:integration para criar PostgreSQL descartável');

const pool = new Pool({ connectionString });
const organizationId = randomUUID();
const unitId = randomUUID();
const secondUnitId = randomUUID();
let ready = false;

beforeAll(async () => {
  await requireDisposableDatabase();
  await pool.query(
    'INSERT INTO occupancy_spike.schedule_units (id, organization_id, name) VALUES ($1, $2, $3), ($4, $2, $5)',
    [unitId, organizationId, 'Quadra A', secondUnitId, 'Quadra B'],
  );
  ready = true;
});

afterAll(async () => {
  try {
    if (ready) {
      await pool.query(
        'DELETE FROM occupancy_spike.schedule_occupancies WHERE organization_id = $1',
        [organizationId],
      );
      await pool.query('DELETE FROM occupancy_spike.schedule_units WHERE organization_id = $1', [
        organizationId,
      ]);
    }
  } finally {
    await pool.end();
  }
});

async function insert(
  client: Client,
  start: string,
  end: string,
  targetUnitId = unitId,
  active = true,
) {
  return client.query(
    `INSERT INTO occupancy_spike.schedule_occupancies
      (id, organization_id, unit_id, start_at, end_at, active)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [randomUUID(), organizationId, targetUnitId, start, end, active],
  );
}

async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await pool.query<{ wait_event_type: string | null }>(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('A transação concorrente não chegou ao lock esperado em 1,5 s');
}

describe('constraint de ocupação', () => {
  it('permite intervalos consecutivos [início, fim)', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await insert(client, '2027-01-05T18:00:00Z', '2027-01-05T19:00:00Z');
      await insert(client, '2027-01-05T19:00:00Z', '2027-01-05T20:00:00Z');
    } finally {
      await client.end();
    }
  });

  it('recusa duração nula ou negativa e gera o período semiaberto', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await expect(
        insert(client, '2027-01-08T19:00:00Z', '2027-01-08T19:00:00Z'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        insert(client, '2027-01-08T20:00:00Z', '2027-01-08T19:00:00Z'),
      ).rejects.toMatchObject({ code: '22000' });
      const inserted = await insert(client, '2027-01-08T18:00:00Z', '2027-01-08T19:00:00Z');
      const result = await client.query<{
        lower_inclusive: boolean;
        upper_inclusive: boolean;
      }>(
        `SELECT lower_inc(period) AS lower_inclusive, upper_inc(period) AS upper_inclusive
         FROM occupancy_spike.schedule_occupancies WHERE id = $1`,
        [inserted.rows[0]?.id],
      );
      expect(result.rows[0]).toEqual({
        lower_inclusive: true,
        upper_inclusive: false,
      });
    } finally {
      await client.end();
    }
  });

  it.each([
    ['parcial', '2027-02-01', '18:30', '19:30'],
    ['total', '2027-02-02', '18:00', '20:00'],
    ['contido', '2027-02-03', '18:15', '18:45'],
  ])('recusa sobreposição %s', async (_label, day, start, end) => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await insert(client, `${day}T18:00:00Z`, `${day}T19:00:00Z`);
      await expect(
        insert(client, `${day}T${start}:00Z`, `${day}T${end}:00Z`),
      ).rejects.toMatchObject({ code: '23P01' });
    } finally {
      await client.end();
    }
  });

  it('permite mesma janela em outra unidade e ocupação inativa', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const start = '2027-02-04T18:00:00Z';
      const end = '2027-02-04T19:00:00Z';
      await insert(client, start, end);
      await insert(client, start, end, secondUnitId);
      const inactive = await insert(client, start, end, unitId, false);
      await expect(
        client.query(
          'UPDATE occupancy_spike.schedule_occupancies SET active = true WHERE id = $1',
          [inactive.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: '23P01' });
    } finally {
      await client.end();
    }
  });

  it('deixa exatamente uma transação vencer uma disputa pelo mesmo intervalo', async () => {
    const first = new Client({ connectionString });
    const second = new Client({ connectionString });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      const pid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      if (!pid) throw new Error('PID da segunda conexão ausente');
      await insert(first, '2027-01-06T18:00:00Z', '2027-01-06T19:00:00Z');
      const competing = insert(second, '2027-01-06T18:30:00Z', '2027-01-06T19:30:00Z');
      void competing.catch(() => undefined);
      await waitUntilBlocked(pid);
      await first.query('COMMIT');
      await expect(competing).rejects.toMatchObject({ code: '23P01' });
      await second.query('ROLLBACK');
      const result = await pool.query(
        `SELECT count(*)::int AS total FROM occupancy_spike.schedule_occupancies
         WHERE organization_id = $1 AND period && tstzrange($2, $3, '[)')`,
        [organizationId, '2027-01-06T18:00:00Z', '2027-01-06T20:00:00Z'],
      );
      expect(result.rows[0]?.total).toBe(1);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('permite a concorrente prosseguir após rollback da primeira', async () => {
    const first = new Client({ connectionString });
    const second = new Client({ connectionString });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      const pid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      if (!pid) throw new Error('PID da segunda conexão ausente');
      await insert(first, '2027-02-05T18:00:00Z', '2027-02-05T19:00:00Z');
      const competing = insert(second, '2027-02-05T18:30:00Z', '2027-02-05T19:30:00Z');
      await waitUntilBlocked(pid);
      await first.query('ROLLBACK');
      await expect(competing).resolves.toMatchObject({ rowCount: 1 });
      await second.query('COMMIT');
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('não persiste metade de uma ocupação com duas unidades', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const start = '2027-02-06T18:00:00Z';
      const end = '2027-02-06T19:00:00Z';
      await insert(client, start, end, secondUnitId);
      await client.query('BEGIN');
      await insert(client, start, end, unitId);
      await expect(insert(client, start, end, secondUnitId)).rejects.toMatchObject({
        code: '23P01',
      });
      await client.query('ROLLBACK');
      const result = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM occupancy_spike.schedule_occupancies
         WHERE organization_id = $1 AND unit_id = $2 AND start_at = $3`,
        [organizationId, unitId, start],
      );
      expect(result.rows[0]?.total).toBe(0);
    } finally {
      await client.end();
    }
  });

  it('recusa uma unidade pertencente a outra organização', async () => {
    await expect(
      pool.query(
        `INSERT INTO occupancy_spike.schedule_occupancies
       (id, organization_id, unit_id, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), randomUUID(), unitId, '2027-01-07T18:00:00Z', '2027-01-07T19:00:00Z'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
