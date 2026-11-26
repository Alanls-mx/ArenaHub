import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { TenantContext } from './for-tenant.js';

/** Experimental repository proving explicit scope; not a product-domain service. */
export function unitRepository(prisma: PrismaClient, context: TenantContext) {
  const organizationId = context.organizationId;
  return {
    get: (id: string) => prisma.scheduleUnit.findFirst({ where: { id, organizationId } }),
    list: () => prisma.scheduleUnit.findMany({ where: { organizationId } }),
    count: () => prisma.scheduleUnit.count({ where: { organizationId } }),
    create: (name: string) =>
      prisma.scheduleUnit.create({ data: { id: randomUUID(), organizationId, name } }),
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
    rawNames: () => prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM occupancy_spike.schedule_units WHERE organization_id=${organizationId}::uuid`,
  };
}
