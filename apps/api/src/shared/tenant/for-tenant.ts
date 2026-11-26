import type { PrismaClient } from '../../generated/prisma/client.js';

export type TenantContext = { readonly organizationId: string };

/** Convenience for top-level reads only. Repositories still apply explicit tenant predicates. */
export function forTenant(client: PrismaClient, context: TenantContext) {
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
              where: { ...scoped.where, organizationId: context.organizationId },
            } as typeof args);
          }
          return query(args);
        },
      },
    },
  });
}
