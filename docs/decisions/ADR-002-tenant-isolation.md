# ADR-002 — Isolamento entre arenas

Status: **provisório; revisão obrigatória após o spike de `forTenant` e antes do piloto**.

Toda tabela tenant usa `organization_id NOT NULL`, e relações entre entidades tenant usam FKs compostas. Repositories recebem `TenantContext` e aplicam filtro explícito. `forTenant(ctx)` ajuda a reduzir erros repetitivos, mas não é uma fronteira de segurança: SQL manual, views, agregações, operações aninhadas e transações exigem verificação própria.

A membership e as capacidades são revalidadas em cada requisição. Remover o usuário de uma arena invalida o acesso àquela arena sem revogar a sessão global ou suas outras memberships.

O spike deve exercitar `connect`, `upsert`, writes aninhados, transações, SQL manual, views e agregações. Se algum caminho não puder ser isolado com confiança por contrato, revisão e teste, a decisão de RLS será reaberta **antes do piloto**, com prova de funcionamento sob pool de conexões. Até lá, não se declara RLS implementada nem dispensada definitivamente.

## Evidência atual (26/11/2026)

O experimento com Prisma 7.10.1 demonstrou filtro auxiliar em `findUnique`, `findFirst`, `findMany`, `count` e `groupBy` de primeiro nível. Testes negativos demonstraram que `$queryRaw`, view global, `update` por ID e escrita aninhada podem acessar ou alterar outra organização mesmo no client estendido. A FK composta bloqueou vínculo cruzado na tabela de ocupação, mas não bloqueia uma operação coerente inteiramente na organização errada. O repository experimental filtrou listagem, contagem, mutações, upsert e SQL parametrizado. Portanto, **a extensão não é uma barreira de segurança**; um repository deve exigir `TenantContext` e inserir `organizationId` no predicado de toda operação. SQL manual, views e agregações precisam do mesmo filtro explícito. Escritas aninhadas e transações não são interceptadas automaticamente pela extensão de query do Prisma.

A matriz completa de `createMany`, `updateMany`, `delete`, `deleteMany`, `upsert`, `connectOrCreate`, escrita/leitura aninhada, transações e views ainda não foi executada. A decisão continua provisória e o gate de isolamento não está aprovado. RLS será considerada com evidências após essa matriz e antes do piloto.
