# Arquitetura

Monólito modular em `apps/api` (Fastify, worker, Prisma, PostgreSQL), `apps/web` (Next.js) e `packages/contracts` (Zod e códigos de erro). A Web não acessa o banco; a API é a fronteira de domínio. O PostgreSQL é a fonte da verdade.

`apps/api/prisma` contém **somente schema experimental da Fase 1**, isolado em `occupancy_spike`. Não há migrations de produção nem entidades completas de identidade, reserva ou financeiro. O worker usa `pg-boss` no schema `arena_jobs`. O futuro host dedicado servirá Web e `/api/v1` no mesmo domínio por proxy.

Toda escrita de ocupação final deverá ocorrer no service de agenda, sob transação, com lock de venue e constraint de exclusão no banco. O `forTenant` experimental só auxilia leituras de primeiro nível; cada repository deve impor escopo explícito. Ver [ADR-002](docs/decisions/ADR-002-tenant-isolation.md).
