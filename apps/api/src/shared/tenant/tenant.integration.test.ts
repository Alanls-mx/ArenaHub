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

  it('createMany, updateMany, delete, deleteMany e aggregate do repository mantêm escopo', async () => {
    const repo = unitRepository(prisma, { organizationId: firstOrg });
    expect((await repo.createMany(['E', 'F'])).count).toBe(2);
    expect((await repo.aggregate())._count).toBe(5);
    expect((await repo.groupBy()).map((group) => group.organizationId)).toEqual([firstOrg]);
    const created = (await repo.list()).filter((unit) => ['E', 'F'].includes(unit.name));
    expect(created).toHaveLength(2);
    const e = created.find((unit) => unit.name === 'E');
    if (!e) throw new Error('Fixture E ausente');
    expect((await repo.deleteMany([secondUnit, e.id])).count).toBe(1);
    expect((await repo.delete(secondUnit)).count).toBe(0);
    const toDelete = await repo.create('Delete unique');
    expect((await repo.deleteUnique(toDelete.id)).id).toBe(toDelete.id);
    await expect(repo.deleteUnique(secondUnit)).rejects.toThrow();
    expect(
      (await prisma.scheduleUnit.findUnique({ where: { id: secondUnit } }))?.organizationId,
    ).toBe(secondOrg);
  });

  it('connect e connectOrCreate compostos impedem referência de outra organização', async () => {
    const repo = unitRepository(prisma, { organizationId: firstOrg });
    const start = new Date('2027-07-01T18:00:00Z');
    const end = new Date('2027-07-01T19:00:00Z');
    await expect(repo.createOccupancy(secondUnit, start, end)).rejects.toThrow();
    await expect(repo.connectOrCreateOccupancy(secondUnit, start, end)).rejects.toThrow();
    const own = await repo.createOccupancy(firstUnit, start, end);
    expect(own.organizationId).toBe(firstOrg);
    const createdUnitId = randomUUID();
    const createdWithRelation = await repo.connectOrCreateOccupancy(
      createdUnitId,
      new Date('2027-07-02T18:00:00Z'),
      new Date('2027-07-02T19:00:00Z'),
    );
    expect(createdWithRelation.organizationId).toBe(firstOrg);
    expect((await repo.occupancies(firstUnit)).map((row) => row.id)).toContain(own.id);
    expect(await repo.occupancies(secondUnit)).toEqual([]);
  });

  it('rejeita contexto ausente, inválido ou reutilizado para outra arena', async () => {
    expect(() => unitRepository(prisma, undefined as never)).toThrow(/TenantContext/);
    expect(() => forTenant(prisma, { organizationId: 'invalid' })).toThrow(/TenantContext/);
    const a = unitRepository(prisma, { organizationId: firstOrg });
    const b = unitRepository(prisma, { organizationId: secondOrg });
    expect(await a.get(secondUnit)).toBeNull();
    expect((await b.get(secondUnit))?.organizationId).toBe(secondOrg);
    expect(await a.get(secondUnit)).toBeNull();
  });

  it('transação em lote e tentativa de trocar organizationId exigem contenção', async () => {
    const [a, b] = await prisma.$transaction([
      prisma.scheduleUnit.count({ where: { organizationId: firstOrg } }),
      prisma.scheduleUnit.count({ where: { organizationId: secondOrg } }),
    ]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(1);
    const movable = await prisma.scheduleUnit.findFirst({
      where: { organizationId: firstOrg, name: 'F' },
    });
    if (!movable) throw new Error('Fixture F ausente');
    const sentinel = new Error('rollback-sentinel');
    await expect(
      prisma.$transaction(async (tx) => {
        const unsafe = await tx.scheduleUnit.update({
          where: { id: movable.id },
          data: { organizationId: secondOrg },
        });
        expect(unsafe.organizationId).toBe(secondOrg);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
    expect(
      (await prisma.scheduleUnit.findUnique({ where: { id: movable.id } }))?.organizationId,
    ).toBe(firstOrg);
  });
});
