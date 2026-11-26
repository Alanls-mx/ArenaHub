import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { requireDisposableDatabase } from '../../__tests__/disposable-database.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { forTenant } from './for-tenant.js';
import { unitRepository } from './unit-repository.js';

const firstOrg = randomUUID();
const secondOrg = randomUUID();
const firstUnit = randomUUID();
const secondUnit = randomUUID();
let prisma: PrismaClient;

beforeAll(async () => {
  const url = await requireDisposableDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }, { schema: 'occupancy_spike' }),
  });
  await prisma.$connect();
  await prisma.scheduleUnit.createMany({
    data: [
      { id: firstUnit, organizationId: firstOrg, name: 'A' },
      { id: secondUnit, organizationId: secondOrg, name: 'B' },
    ],
  });
  await prisma.$executeRawUnsafe(`CREATE VIEW occupancy_spike.unit_counts AS
    SELECT organization_id, count(*)::int AS total FROM occupancy_spike.schedule_units GROUP BY organization_id`);
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.$executeRawUnsafe('DROP VIEW occupancy_spike.unit_counts');
  await prisma.scheduleOccupancy.deleteMany({
    where: { organizationId: { in: [firstOrg, secondOrg] } },
  });
  await prisma.scheduleUnit.deleteMany({
    where: { organizationId: { in: [firstOrg, secondOrg] } },
  });
  await prisma.$disconnect();
});

describe('limites do forTenant', () => {
  it('filtra leituras de primeiro nível e agregações comuns', async () => {
    const tenant = forTenant(prisma, { organizationId: firstOrg });
    expect(await tenant.scheduleUnit.findUnique({ where: { id: secondUnit } })).toBeNull();
    expect(await tenant.scheduleUnit.findFirst({ where: { id: secondUnit } })).toBeNull();
    expect(await tenant.scheduleUnit.findMany()).toMatchObject([{ id: firstUnit }]);
    expect(await tenant.scheduleUnit.count()).toBe(1);
    expect(
      (await tenant.scheduleUnit.groupBy({ by: ['organizationId'] })).map(
        (row) => row.organizationId,
      ),
    ).toEqual([firstOrg]);
  });

  it('não protege SQL manual nem escrita: repository precisa aplicar escopo', async () => {
    const tenant = forTenant(prisma, { organizationId: firstOrg });
    const raw = await tenant.$queryRaw<
      { id: string }[]
    >`SELECT id FROM occupancy_spike.schedule_units WHERE id = ${secondUnit}::uuid`;
    expect(raw).toMatchObject([{ id: secondUnit }]);
    const unsafe = await tenant.scheduleUnit.update({
      where: { id: secondUnit },
      data: { name: 'B2' },
    });
    expect(unsafe.organizationId).toBe(secondOrg);
    const safe = await prisma.scheduleUnit.findFirst({
      where: { id: secondUnit, organizationId: firstOrg },
    });
    expect(safe).toBeNull();
  });

  it('impede vínculo cruzado pela FK composta', async () => {
    await expect(
      prisma.scheduleOccupancy.create({
        data: {
          id: randomUUID(),
          organizationId: firstOrg,
          unitId: secondUnit,
          startAt: new Date('2027-05-01T18:00:00Z'),
          endAt: new Date('2027-05-01T19:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('repository aplica escopo em listagem, mutações, upsert e SQL manual', async () => {
    const repo = unitRepository(prisma, { organizationId: firstOrg });
    expect(await repo.get(secondUnit)).toBeNull();
    expect((await repo.list()).map((unit) => unit.id)).toEqual([firstUnit]);
    expect(await repo.count()).toBe(1);
    expect(await repo.update(secondUnit, 'nunca')).toBeNull();
    expect((await repo.delete(secondUnit)).count).toBe(0);
    expect((await repo.rawNames()).map((row) => row.name)).toEqual(['A']);
    const inserted = await repo.create('C');
    expect(inserted.organizationId).toBe(firstOrg);
    const upserted = await repo.upsert(randomUUID(), 'D');
    expect(upserted.organizationId).toBe(firstOrg);
    expect((await prisma.scheduleUnit.findUnique({ where: { id: secondUnit } }))?.name).toBe('B2');
  });

  it('transação e agregação explícitas mantêm contexto', async () => {
    const counts = await prisma.$transaction(async (tx) => {
      const a = await tx.scheduleUnit.count({ where: { organizationId: firstOrg } });
      const b = await tx.scheduleUnit.count({ where: { organizationId: secondOrg } });
      return { a, b };
    });
    expect(counts).toEqual({ a: 3, b: 1 });
    const groups = await prisma.scheduleUnit.groupBy({
      by: ['organizationId'],
      where: { organizationId: firstOrg },
      _count: true,
    });
    expect(groups).toMatchObject([{ organizationId: firstOrg, _count: 3 }]);
  });

  it('view global exige filtro e escrita aninhada não é interceptada', async () => {
    const tenant = forTenant(prisma, { organizationId: firstOrg });
    const unscoped = await tenant.$queryRaw<{ organization_id: string; total: number }[]>`
      SELECT organization_id, total FROM occupancy_spike.unit_counts`;
    expect(unscoped.map((row) => row.organization_id).sort()).toEqual([firstOrg, secondOrg].sort());
    const scoped = await prisma.$queryRaw<{ organization_id: string; total: number }[]>`
      SELECT organization_id, total FROM occupancy_spike.unit_counts
      WHERE organization_id=${firstOrg}::uuid`;
    expect(scoped).toMatchObject([{ organization_id: firstOrg, total: 3 }]);

    const nested = await tenant.scheduleUnit.update({
      where: { id: secondUnit },
      data: {
        occupancies: {
          create: {
            id: randomUUID(),
            startAt: new Date('2027-06-01T18:00:00Z'),
            endAt: new Date('2027-06-01T19:00:00Z'),
          },
        },
      },
      include: { occupancies: true },
    });
    expect(nested.organizationId).toBe(secondOrg);
    expect(nested.occupancies).toHaveLength(1);
  });
});
