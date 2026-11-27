import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';

export type TenantContext = { readonly organizationId: string };

export function requireTenantContext(context: TenantContext): TenantContext {
  const parsed = z.object({ organizationId: z.uuid() }).safeParse(context);
  if (!parsed.success) throw new Error('TenantContext ausente ou inválido');
  return parsed.data;
}

/** Convenience for top-level reads only. Repositories still apply explicit tenant predicates. */
export function forTenant(client: PrismaClient, context: TenantContext) {
  const organizationId = requireTenantContext(context).organizationId;
  return client.$extends({
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          if (
            [
              'findUnique',
              'findUniqueOrThrow',
              'findFirst',
              'findFirstOrThrow',
              'findMany',
              'count',
              'aggregate',
              'groupBy',
            ].includes(operation)
          ) {
            const scoped = args as typeof args & { where?: Record<string, unknown> };
            return query({
              ...scoped,
              where: { ...scoped.where, organizationId },
            } as typeof args);
          }
          return query(args);
        },
      },
    },
  });
}
