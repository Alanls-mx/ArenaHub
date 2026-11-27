import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';
import { PrismaClient } from '../../generated/prisma/client.js';

const orgA = randomUUID();
const orgB = randomUUID();
const unitA = randomUUID();
const unitB = randomUUID();
const role = `arena_app_${randomBytes(6).toString('hex')}`;
const owner = `arena_owner_${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
let admin: Client;
let app: Pool;
let prisma: PrismaClient;
let ownerClient: Client;

function roleUrl(url: string, username: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

async function inTenant<T>(
  organizationId: string,
  operation: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arena.organization_id', $1, true)", [organizationId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const url = await requireDisposableDatabase();
  admin = new Client({ connectionString: url });
  await admin.connect();
  // Identifiers and password are generated solely from hex, never user input.
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOBYPASSRLS NOSUPERUSER`);
  await admin.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${password}' NOBYPASSRLS NOSUPERUSER`);
  await admin.query('CREATE SCHEMA rls_spike');
  await admin.query(`GRANT USAGE ON SCHEMA rls_spike TO ${role}, ${owner}`);
  await admin.query(`CREATE TABLE rls_spike.schedule_units (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL,
    UNIQUE (organization_id, id))`);
  await admin.query(`CREATE TABLE rls_spike.schedule_occupancies (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, unit_id uuid NOT NULL,
    start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
    period tstzrange GENERATED ALWAYS AS (tstzrange(start_at,end_at,'[)')) STORED,
    active boolean NOT NULL DEFAULT true,
    UNIQUE (organization_id,id),
    FOREIGN KEY (organization_id,unit_id) REFERENCES rls_spike.schedule_units(organization_id,id))`);
  await admin.query(`ALTER TABLE rls_spike.schedule_units OWNER TO ${owner}`);
  await admin.query(`ALTER TABLE rls_spike.schedule_occupancies OWNER TO ${owner}`);
  await admin.query(
    `INSERT INTO rls_spike.schedule_units (id,organization_id,name) VALUES
    ($1,$2,'A'),($3,$4,'B')`,
    [unitA, orgA, unitB, orgB],
  );
  await admin.query(`ALTER TABLE rls_spike.schedule_units ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE rls_spike.schedule_units FORCE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE rls_spike.schedule_occupancies ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE rls_spike.schedule_occupancies FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY tenant_units ON rls_spike.schedule_units
    USING (organization_id = NULLIF(current_setting('arena.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('arena.organization_id', true), '')::uuid)`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON rls_spike.schedule_units TO ${role}`);
  await admin.query(`CREATE POLICY tenant_occupancies ON rls_spike.schedule_occupancies
    USING (organization_id = NULLIF(current_setting('arena.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('arena.organization_id', true), '')::uuid)`);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON rls_spike.schedule_occupancies TO ${role}`,
  );
  await admin.query(`CREATE VIEW rls_spike.unit_counts WITH (security_invoker=true) AS
    SELECT organization_id, count(*)::int AS total FROM rls_spike.schedule_units GROUP BY organization_id`);
  await admin.query(`GRANT SELECT ON rls_spike.unit_counts TO ${role}`);
  app = new Pool({ connectionString: roleUrl(url, role), max: 1 });
  ownerClient = new Client({ connectionString: roleUrl(url, owner) });
  await ownerClient.connect();
  prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: roleUrl(url, role), max: 1 },
      { schema: 'rls_spike' },
    ),
  });
  await prisma.$connect();
}, 20_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await app?.end();
  await ownerClient?.end();
  if (admin) {
    await admin.query('DROP SCHEMA IF EXISTS rls_spike CASCADE');
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    await admin.end();
  }
});

describe('RLS isolado no banco descartável', () => {
  it('papel da aplicação e owner não bypassam RLS; ausência de contexto nega leitura', async () => {
    const flags = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1',
      [role],
    );
    expect(flags.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await app.query('SELECT * FROM rls_spike.schedule_units')).rows).toEqual([]);
    expect((await ownerClient.query('SELECT * FROM rls_spike.schedule_units')).rows).toEqual([]);
  });

  it('SELECT, INSERT, UPDATE e DELETE ficam limitados ao tenant da transação', async () => {
    await inTenant(orgA, async (client) => {
      expect((await client.query('SELECT id FROM rls_spike.schedule_units')).rows).toMatchObject([
        { id: unitA },
      ]);
      expect(
        (
          await client.query('UPDATE rls_spike.schedule_units SET name=$1 WHERE id=$2', [
            'changed',
            unitB,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await client.query('DELETE FROM rls_spike.schedule_units WHERE id=$1', [unitB])).rowCount,
      ).toBe(0);
    });
    await expect(
      inTenant(orgA, (client) =>
        client.query(
          'INSERT INTO rls_spike.schedule_units (id,organization_id,name) VALUES ($1,$2,$3)',
          [randomUUID(), orgB, 'cross'],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // The denied INSERT aborts its transaction; the wrapper rolls it back.
    const visible = await inTenant(orgB, async (client) =>
      client.query('SELECT id FROM rls_spike.schedule_units'),
    );
    expect(visible.rows).toMatchObject([{ id: unitB }]);
  });

  it('WITH CHECK bloqueia troca de organização e permite escrita própria', async () => {
    const ownId = randomUUID();
    await inTenant(orgA, async (client) => {
      expect(
        (
          await client.query(
            'INSERT INTO rls_spike.schedule_units (id,organization_id,name) VALUES ($1,$2,$3)',
            [ownId, orgA, 'own'],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await client.query('UPDATE rls_spike.schedule_units SET name=$1 WHERE id=$2', [
            'updated',
            ownId,
          ])
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      inTenant(orgA, (client) =>
        client.query('UPDATE rls_spike.schedule_units SET organization_id=$1 WHERE id=$2', [
          orgB,
          ownId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await inTenant(orgA, async (client) => {
      expect(
        (await client.query('DELETE FROM rls_spike.schedule_units WHERE id=$1', [ownId])).rowCount,
      ).toBe(1);
    });
  });

  it('pool reutilizado perde SET LOCAL; contexto inválido falha fechado', async () => {
    expect((await app.query('SELECT id FROM rls_spike.schedule_units')).rows).toEqual([]);
    await expect(
      inTenant('invalid-uuid', (client) => client.query('SELECT id FROM rls_spike.schedule_units')),
    ).rejects.toMatchObject({ code: '22P02' });
    expect((await app.query('SELECT id FROM rls_spike.schedule_units')).rows).toEqual([]);
  });

  it('GUC customizada não autentica tenant: código com SQL arbitrário pode defini-la', async () => {
    const observed = await inTenant(orgB, async (client) =>
      client.query('SELECT id FROM rls_spike.schedule_units'),
    );
    expect(observed.rows).toMatchObject([{ id: unitB }]);
  });

  it('Prisma interactive transaction, SQL manual e view security_invoker respeitam RLS', async () => {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('arena.organization_id', ${orgA}, true)`;
      const units = await tx.scheduleUnit.findMany();
      const view = await tx.$queryRaw<{ organization_id: string; total: number }[]>`
        SELECT * FROM rls_spike.unit_counts`;
      return { units, view };
    });
    expect(result.units.map((unit) => unit.id)).toEqual([unitA]);
    expect(result.view).toMatchObject([{ organization_id: orgA, total: 1 }]);
    expect(await prisma.scheduleUnit.findMany()).toEqual([]);
  });

  it('Prisma nested write não atravessa tenant com RLS e FK composta', async () => {
    const own = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('arena.organization_id', ${orgA}, true)`;
      return tx.scheduleUnit.update({
        where: { id: unitA },
        data: {
          occupancies: {
            create: {
              id: randomUUID(),
              startAt: new Date('2027-08-01T18:00:00Z'),
              endAt: new Date('2027-08-01T19:00:00Z'),
            },
          },
        },
        include: { occupancies: true },
      });
    });
    expect(own.occupancies).toHaveLength(1);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('arena.organization_id', ${orgA}, true)`;
        return tx.scheduleUnit.update({
          where: { id: unitB },
          data: {
            occupancies: {
              create: {
                id: randomUUID(),
                startAt: new Date('2027-08-01T18:00:00Z'),
                endAt: new Date('2027-08-01T19:00:00Z'),
              },
            },
          },
        });
      }),
    ).rejects.toThrow();
    const bCount = await inTenant(orgB, async (client) =>
      client.query('SELECT count(*)::int AS total FROM rls_spike.schedule_occupancies'),
    );
    expect(bCount.rows[0]?.total).toBe(0);
  });
});
