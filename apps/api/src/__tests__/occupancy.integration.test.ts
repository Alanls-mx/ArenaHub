import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: '../../.env' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente');

const pool = new Pool({ connectionString });
const organizationId = randomUUID();
const unitId = randomUUID();

beforeAll(async () => {
  await pool.query(
    'INSERT INTO occupancy_spike.schedule_units (id, organization_id, name) VALUES ($1, $2, $3)',
    [unitId, organizationId, 'Quadra de teste']
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM occupancy_spike.schedule_occupancies WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM occupancy_spike.schedule_units WHERE organization_id = $1', [organizationId]);
  await pool.end();
});

async function insert(client: Client, start: string, end: string) {
  return client.query(
    `INSERT INTO occupancy_spike.schedule_occupancies
      (id, organization_id, unit_id, start_at, end_at)
      VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), organizationId, unitId, start, end]
  );
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

  it('deixa exatamente uma transação vencer uma disputa pelo mesmo intervalo', async () => {
    const first = new Client({ connectionString });
    const second = new Client({ connectionString });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await insert(first, '2027-01-06T18:00:00Z', '2027-01-06T19:00:00Z');
      const competing = insert(second, '2027-01-06T18:30:00Z', '2027-01-06T19:30:00Z');
      await first.query('COMMIT');
      await expect(competing).rejects.toMatchObject({ code: '23P01' });
      await second.query('ROLLBACK');
      const result = await pool.query(
        `SELECT count(*)::int AS total FROM occupancy_spike.schedule_occupancies
         WHERE organization_id = $1 AND period && tstzrange($2, $3, '[)')`,
        [organizationId, '2027-01-06T18:00:00Z', '2027-01-06T20:00:00Z']
      );
      expect(result.rows[0]?.total).toBe(1);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('recusa uma unidade pertencente a outra organização', async () => {
    await expect(pool.query(
      `INSERT INTO occupancy_spike.schedule_occupancies
       (id, organization_id, unit_id, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), randomUUID(), unitId, '2027-01-07T18:00:00Z', '2027-01-07T19:00:00Z']
    )).rejects.toMatchObject({ code: '23503' });
  });
});

