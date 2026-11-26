import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDisposableDatabase, requireDisposableDatabase } from './disposable-database.js';

let client: Client;

beforeAll(async () => {
  const connectionString = await requireDisposableDatabase();
  client = new Client({ connectionString });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

describe('objetos SQL do spike após migrations sucessivas', () => {
  it('aceita marcador do runner e recusa marcador divergente', async () => {
    const url = await requireDisposableDatabase();
    const token = process.env.ARENAHUB_TEST_DB_TOKEN;
    if (!token) throw new Error('Marcador do runner ausente');
    await expect(assertDisposableDatabase(url, token)).resolves.toBeUndefined();
    await expect(assertDisposableDatabase(url, '0'.repeat(32))).rejects.toThrow(/divergente/);
  });
  it('mantém extensão, período gerado e intervalo válido', async () => {
    const extension = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'");
    expect(extension.rowCount).toBe(1);
    const column = await client.query<{
      attgenerated: string;
      type: string;
      expression: string;
    }>(`
      SELECT a.attgenerated, format_type(a.atttypid, a.atttypmod) AS type,
             pg_get_expr(d.adbin, d.adrelid) AS expression
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'occupancy_spike' AND c.relname = 'schedule_occupancies'
        AND a.attname = 'period'`);
    expect(column.rows[0]).toMatchObject({
      attgenerated: 's',
      type: 'tstzrange',
    });
    expect(column.rows[0]?.expression).toMatch(/tstzrange\(start_at, end_at, '\[\)'/);
  });

  it('mantém exclusão GiST parcial com igualdade de unidade e sobreposição de período', async () => {
    const result = await client.query<{
      definition: string;
      predicate: string;
    }>(`
      SELECT pg_get_constraintdef(con.oid) AS definition,
             pg_get_expr(idx.indpred, idx.indrelid) AS predicate
      FROM pg_constraint con
      JOIN pg_namespace n ON n.oid = con.connamespace
      JOIN pg_index idx ON idx.indexrelid = con.conindid
      WHERE n.nspname = 'occupancy_spike' AND con.conname = 'schedule_no_overlap'
        AND con.contype = 'x'`);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]?.definition).toMatch(
      /EXCLUDE USING gist \(unit_id WITH =, period WITH &&\)/,
    );
    expect(result.rows[0]?.predicate).toMatch(/active/);
  });

  it('mantém FK composta e CHECK de duração positiva', async () => {
    const result = await client.query<{
      name: string;
      type: string;
      definition: string;
    }>(`
      SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
      WHERE n.nspname = 'occupancy_spike' AND con.conrelid =
        'occupancy_spike.schedule_occupancies'::regclass`);
    const fk = result.rows.find((row) => row.type === 'f');
    expect(fk?.definition).toMatch(/FOREIGN KEY \(organization_id, unit_id\)/);
    expect(fk?.definition).toMatch(/REFERENCES .*schedule_units\(organization_id, id\)/);
    const check = result.rows.find((row) => row.name === 'schedule_occupancies_valid_interval');
    expect(check?.definition).toMatch(/end_at > start_at/);
  });
});
