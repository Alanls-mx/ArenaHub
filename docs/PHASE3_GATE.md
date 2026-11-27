# Gate da Fase 3 — estrutura operacional

Estado: **Fase 3 tecnicamente aprovada**. Os gates locais e o CI remoto Linux passaram. O PR permanece em rascunho; não houve merge ou deploy.

## Mapa do sistema implementado

Next.js (`access-client.tsx` e `operations-client.tsx`) envia formulários e simulações a `/api/v1/orgs/:slug`. O proxy de mesmo host entrega à API Fastify. `operationalRoutes` revalida sessão, origem/CSRF, host, organização, membership e capability em cada requisição. Contratos Zod em `packages/contracts/src/operations.ts` validam entradas e saídas da Web; [OpenAPI 3.1](OPENAPI_PHASE3.json) é gerada dos mesmos schemas e conferida pelo CI. A transação SQL usa `arena_identity`, filtro explícito de `organization_id`, FKs compostas e auditoria. Composição, horários e preços adquirem o lock do venue após o da organização. O cálculo puro em `operations/rules.ts` usa datas civis locais; a simulação apenas lê. `pg-boss` e `occupancy_spike` não participam dessas operações.

## Critérios e evidências

| Critério                                               | Estado   | Evidência                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nove entidades, migration aditiva e Prisma sem drift   | Aprovado | `20261127014000_operational_structure`, `identity.prisma`; `db:check` em PostgreSQL 16 descartável sem drift e com constraints SQL verificadas                                                                                             |
| CRUD e isolamento, RBAC, composição, horário e preço   | Aprovado | `structure.integration.test.ts`, `rules.test.ts`; 64/64 testes de integração e 23/23 unitários na última execução                                                                                                                          |
| Cenário integral pela interface em menos de 30 minutos | Aprovado | `visual-phase3.ts`: 5 s, dados operacionais persistidos pela interface; [capturas](evidence/phase3/) em 1440, 768 e 390 px                                                                                                                 |
| Gates locais completos                                 | Aprovado | lint, format, typecheck, OpenAPI, unitários (23/23), integração (64/64), build e diff                                                                                                                                                      |
| CI remoto                                              | Aprovado | SHA `492826b0ec38a8dab54c8ed058fb96dba9af55d4`: [push](https://github.com/Alanls-mx/ArenaHub/actions/runs/46078020598) e [PR](https://github.com/Alanls-mx/ArenaHub/actions/runs/46078086613), com integração PostgreSQL e build aprovados |

## Limites

O cálculo de preço simula um intervalo local e não garante disponibilidade nem cria reserva. A Fase 4 deverá consumir o mesmo lock do venue e proteger alterações de composição contra ocupações futuras. As faixas de preço não atravessam meia-noite em uma linha: cadastre duas regras. Domínios próprios ficam `pending` até controles de DNS, TLS e login entre hosts. RLS continua uma decisão para antes do piloto; filtros por tenant, FKs e testes negativos são obrigatórios em cada novo caminho. Não há contas públicas de clientes, agenda definitiva ou financeiro nesta fase.
