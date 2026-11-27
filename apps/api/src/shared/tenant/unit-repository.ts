import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requireTenantContext, type TenantContext } from './for-tenant.js';

/** Experimental repository proving explicit scope; not a product-domain service. */
export function unitRepository(prisma: PrismaClient, context: TenantContext) {
  const organizationId = requireTenantContext(context).organizationId;
  return {
    get: (id: string) =>
      prisma.scheduleUnit.findUnique({
        where: { organizationId_id: { organizationId, id } },
      }),
    list: () => prisma.scheduleUnit.findMany({ where: { organizationId } }),
    count: () => prisma.scheduleUnit.count({ where: { organizationId } }),
    create: (name: string) =>
      prisma.scheduleUnit.create({ data: { id: randomUUID(), organizationId, name } }),
    createMany: (names: string[]) =>
      prisma.scheduleUnit.createMany({
        data: names.map((name) => ({ id: randomUUID(), organizationId, name })),
      }),
    async update(id: string, name: string) {
      const changed = await prisma.scheduleUnit.updateMany({
        where: { id, organizationId },
        data: { name },
      });
      return changed.count === 0
        ? null
        : prisma.scheduleUnit.findFirst({ where: { id, organizationId } });
    },
    delete: (id: string) => prisma.scheduleUnit.deleteMany({ where: { id, organizationId } }),
    deleteUnique: (id: string) =>
      prisma.scheduleUnit.delete({
        where: { organizationId_id: { organizationId, id } },
      }),
    deleteMany: (ids: string[]) =>
      prisma.scheduleUnit.deleteMany({
        where: { organizationId, id: { in: ids } },
      }),
    upsert: (id: string, name: string) =>
      prisma.scheduleUnit.upsert({
        where: { organizationId_id: { organizationId, id } },
        create: { id, organizationId, name },
        update: { name },
      }),
    occupancies: (unitId: string) =>
      prisma.scheduleOccupancy.findMany({
        where: { organizationId, unitId },
      }),
    aggregate: () =>
      prisma.scheduleUnit.aggregate({
        where: { organizationId },
        _count: true,
      }),
    groupBy: () =>
      prisma.scheduleUnit.groupBy({
        by: ['organizationId'],
        where: { organizationId },
        _count: true,
      }),
    createOccupancy: (unitId: string, startAt: Date, endAt: Date) =>
      prisma.scheduleOccupancy.create({
        data: {
          id: randomUUID(),
          startAt,
          endAt,
          unit: { connect: { organizationId_id: { organizationId, id: unitId } } },
        },
      }),
    connectOrCreateOccupancy: (unitId: string, startAt: Date, endAt: Date) =>
      prisma.scheduleOccupancy.create({
        data: {
          id: randomUUID(),
          startAt,
          endAt,
          unit: {
            connectOrCreate: {
              where: { organizationId_id: { organizationId, id: unitId } },
              create: { id: unitId, organizationId, name: 'Synthetic' },
            },
          },
        },
      }),
    rawNames: () => prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM occupancy_spike.schedule_units WHERE organization_id=${organizationId}::uuid`,
  };
}
