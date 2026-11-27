# ADR-004 — Prisma e exclusion constraint

Status: **spike aprovado para prosseguir**, em 26/11/2026. A migration atual contém apenas as tabelas mínimas do experimento no schema PostgreSQL `occupancy_spike`; o modelo final de domínio entra nas fases seguintes.

## Resultado

- PostgreSQL 16 aceitou `tstzrange` gerado e `EXCLUDE USING gist` parcial por unidade ativa.
- O Prisma 7.10.1 aceitou `period Unsupported("tstzrange")? @default(dbgenerated())` sem propor sua remoção.
- A FK composta precisou de relação equivalente no schema Prisma e nome padrão da constraint para evitar diff.
- `prisma migrate dev` terminou com “Already in sync”; `prisma migrate diff` não encontrou diferença.
- Teste com duas conexões confirmou que só uma reserva simultânea vence (`23P01`). Intervalos `[18h,19h)` e `[19h,20h)` coexistem; FK composta impede unidade de outra organização.

## Decisão

Manter Prisma para modelos comuns e SQL manual na migration da agenda. O service traduz `23P01` para `SLOT_UNAVAILABLE`. O teste de integração deve rodar no CI contra PostgreSQL real. O schema `occupancy_spike` é isolado do futuro schema de domínio `public`; essas migrations experimentais não entram no fluxo de deploy de produção.

## Revalidação da Fase 1

O runner Testcontainers aplicou as migrations sucessivas em banco vazio, executou `prisma migrate diff` sem drift e inspecionou `pg_constraint`, `pg_extension` e a coluna gerada. Testes com conexões independentes provaram commit concorrente único, prosseguimento após rollback, exclusão de reativação conflitante e atomicidade de duas unidades. Intervalo invertido falha com SQLSTATE `22000` na construção do range; duração nula falha com `23514` na CHECK. O schema agora contém também a infraestrutura **experimental** de idempotência; permanece separado da produção.
