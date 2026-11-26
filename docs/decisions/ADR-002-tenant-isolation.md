# ADR-002 — Isolamento entre arenas

Status: **provisório; revisão obrigatória após o spike de `forTenant` e antes do piloto**.

Toda tabela tenant usa `organization_id NOT NULL`, e relações entre entidades tenant usam FKs compostas. Repositories recebem `TenantContext` e aplicam filtro explícito. `forTenant(ctx)` ajuda a reduzir erros repetitivos, mas não é uma fronteira de segurança: SQL manual, views, agregações, operações aninhadas e transações exigem verificação própria.

A membership e as capacidades são revalidadas em cada requisição. Remover o usuário de uma arena invalida o acesso àquela arena sem revogar a sessão global ou suas outras memberships.

O spike deve exercitar `connect`, `upsert`, writes aninhados, transações, SQL manual, views e agregações. Se algum caminho não puder ser isolado com confiança por contrato, revisão e teste, a decisão de RLS será reaberta **antes do piloto**, com prova de funcionamento sob pool de conexões. Até lá, não se declara RLS implementada nem dispensada definitivamente.
