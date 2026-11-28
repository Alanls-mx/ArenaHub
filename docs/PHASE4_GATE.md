# Gate da Fase 4 — motor de reservas

Estado em 28/11/2026: **FASE 4 CONCLUÍDA — MOTOR DE RESERVAS, MENSALISTAS E AGENDA EM TEMPO REAL APROVADOS.** A pendência P1 de validação dos três escritores foi encerrada no PostgreSQL descartável local e no CI Linux. O PR de implementação foi mesclado tradicionalmente na `main`, cujo CI também passou. Pareceres históricos das Fases 1–3 permanecem intactos.

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

## Publicação e CI Linux

O [PR #6](https://github.com/Alanls-mx/ArenaHub/pull/6) publicou o HEAD `61fe427da35e58b5a094dff7e9a026efcea0ebfb`, sem conflitos ou alterações posteriores. Os runs de [push](https://github.com/Alanls-mx/ArenaHub/actions/runs/46109548816) e [PR](https://github.com/Alanls-mx/ArenaHub/actions/runs/46109581156) passaram nesse SHA: lockfile congelado, Prisma, lint, formatação, typecheck, OpenAPI, unitários, integração com PostgreSQL descartável, migrations, `db:check` e build. A suíte remota inclui os três escritores. O merge tradicional `b06fca76a320801a5aeb05e92ad533e988b33db9` preserva a `main` anterior e o commit validado como pais. O [CI da `main`](https://github.com/Alanls-mx/ArenaHub/actions/runs/46109776329) passou nesse merge. A `main` local foi sincronizada por fast-forward e estava limpa após o merge. Nove migrations, inclusive `20261127015000_booking_engine`, foram aplicadas apenas em bancos descartáveis; não houve deploy ou migração de banco real.

## Limites posteriores à Fase 4

O proxy de upgrade WebSocket no host de produção, tempo de configuração por pessoa e latência de rede real não foram medidos. Decisões comerciais abertas no ADR-014 não geram cobrança automática. Cobranças, pagamentos, Mercado Pago, conciliação, reembolsos e inadimplência efetiva pertencem à Fase 5. DNS/TLS, SMTP de produção, homologação jurídica, reavaliação de RLS e carga representativa de produção permanecem antes do piloto, conforme seus gates próprios.

**Veredito:** nenhum P0/P1 remanescente comprovado; gate da Fase 4 aprovado. Não iniciar Fase 5 nesta missão.
