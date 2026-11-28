# Gate da Fase 4 — motor de reservas

Estado local em 28/11/2026: **IMPLEMENTAÇÃO E GATES LOCAIS APROVADOS; PUBLICAÇÃO E CI REMOTO PENDENTES**. A pendência P1 de validação dos três escritores foi encerrada localmente. A branch `feat/phase-4-booking-engine` parte de `main` `af3bad591287cbeb948c51bc164ffc5c5e4df47a`. A missão de encerramento autoriza PR e merge tradicional após os checks remotos. Pareceres históricos das Fases 1–3 permanecem intactos.

## Entregas verificadas

- Migration aditiva `20261127015000_booking_engine` no schema `arena_identity`, com reservas, ocupações físicas, bloqueios, contratos/versões/regras/exceções recorrentes, histórico, resultados comerciais, referências internas de confirmação financeira e idempotência definitiva. `db:check` e Prisma sem drift em PostgreSQL descartável. A constraint GiST rejeita conflitos físicos e a constraint de versões rejeita vigências sobrepostas.
- Reservas pendentes e confirmadas ocupam todas as unidades vinculadas ao venue. Disponibilidade, preço em centavos, remarcação atômica, cancelamento, no-show, conclusão, bloqueio, histórico e replay de chave passaram nos testes dirigidos. A confirmação financeira interna aceita somente prova previamente validada, sem criar cobrança ou pagamento.
- Mensalistas usam contrato estável, versões não sobrepostas e geração de dez semanas no fuso da arena. Conflitos são isolados, podem ser resolvidos e não duplicam reservas. Primeiro mês proporcional é estimado antes da criação e calculado pela mesma função pura no POST. `pg-boss` agenda a geração horária.
- Agenda diária/semanal e atendimento presencial na Web, com permissões por capability, prévias de remarcação/cancelamento, conflitos, busca, detalhes, versão e encerramento de contratos. Canal WebSocket autenticado usa PostgreSQL `LISTEN/NOTIFY` após commit e refetch HTTP. Testes cobrem reconexão do listener, unicidade de conexão, revogação de sessão/membership, evento do worker e parada total do PostgreSQL com porta estável.
- Cenário real automatizado com Next production, Fastify, PostgreSQL descartável e dois contextos autenticados passou novamente. O segundo navegador recebeu o frame WebSocket `reservation.changed` antes de exibir a reserva criada no primeiro; a API real persistiu duas ocupações. Evidências desktop 1440×900, tablet 768×1024 e mobile 390×844 em `docs/evidence/phase4/`. As ações foram feitas pela interface; SQL insere apenas o volume sintético do benchmark. O script inteiro levou 14 segundos automatizados; não é medição de operação humana.
- Com 300 reservas sintéticas em três venues: SQL 1,55–2,39 ms (5), HTTP 10,52–12,24 ms (5), alternância/renderização semanal 93,94–113,70 ms (3). Todas as medidas locais ficaram abaixo de 300 ms; não constituem SLA de produção. Ver `PHASE4_PERFORMANCE.md`.
- A prova simultânea de reserva avulsa, gerador recorrente e bloqueio administrativo passou três vezes consecutivas em PostgreSQL descartável: 3/3 cenários por execução, três PIDs em espera por disputa, um vencedor por horário, duas ocupações da composição inteira, derrotados tratados sem efeitos parciais. Ver `PHASE4_REVIEW.md`.

## Gates locais

| Gate                    | Último resultado                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`             | Aprovado                                                                                                                                   |
| `pnpm format:check`     | Aprovado após formatar o benchmark gerado                                                                                                  |
| `pnpm typecheck`        | Aprovado                                                                                                                                   |
| `pnpm test`             | 26/26 aprovados                                                                                                                            |
| `pnpm test:integration` | 89/89 aprovados, 14 arquivos, após migrations e `db:check` em PostgreSQL descartável; três escritores 3/3 e outage WebSocket 1/1 aprovados |
| `pnpm openapi:check`    | Aprovado; `OPENAPI_PHASE4.json` atualizado                                                                                                 |
| `pnpm build`            | Aprovado                                                                                                                                   |
| `git diff --check`      | Aprovado                                                                                                                                   |
| Runner visual da Fase 4 | Aprovado, sem 429 ou erro no navegador                                                                                                     |

Uma execução anterior de `pnpm test:integration` encerrou o fork Windows do Vitest com `0xC0000409` durante `access.integration.test.ts` após 77 testes passarem. Uma repetição serial passou 82/82 antes dos novos testes de concorrência e falha; as três repetições seguintes no comando padrão passaram 84/84, 85/85 e 86/86. A causa nativa continua não comprovada, como no registro histórico `PHASE1_RUNNER_A2_RESOLUTION.md`. Nenhum teste foi excluído. O primeiro ensaio de outage do WebSocket falhou por mudança da porta dinâmica do fixture (32791→32792); um fixture isolado com porta fixa passou, sem mudança de produção.

## Pendências para encerramento formal

- CI remoto no SHA publicado, revisão do PR e merge tradicional ainda não ocorreram. Sem isso, não há aprovação definitiva da fase.
- Proxy de upgrade WebSocket no host de produção, tempo de configuração por pessoa e latência de rede real não foram medidos. Decisões comerciais abertas no ADR-014 não geram cobrança automática.

**Veredito:** Fase 4 implementada e validada localmente, sem P0/P1 remanescente comprovado. O gate formal aguarda PR, CI remoto e CI da main após merge. Não iniciar Fase 5.
