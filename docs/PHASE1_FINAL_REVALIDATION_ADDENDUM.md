# Adendo de revalidação final da Fase 1 — 26/11/2026

Este adendo registra evidências posteriores à auditoria independente original e ao parecer intermediário. Não altera o veredito histórico **REPROVADO TECNICAMENTE** em `PHASE1_AUDIT.md` nem reescreve a **REVALIDAÇÃO INCONCLUSIVA** em `PHASE1_AUDIT_REVALIDATION.md`; registra que a falha do runner não se reproduziu em duas execuções completas posteriores.

## A2 — revisão do teste dedicado

O teste `não aplica o timeout de aquisição da chave ao lock de negócio dentro do efeito` foi inspecionado e executado contra PostgreSQL descartável real. Ele usa conexões independentes: uma mantém `FOR UPDATE` na linha de domínio; outra executa `executeIdempotent` e adquire a chave, entrando no callback `effect` da mesma transação. O harness observa a espera por lock via `pg_stat_activity.wait_event_type='Lock'`, mantém o bloqueio por 5,2 segundos (além do timeout de aquisição da chave) e só então libera a transação bloqueadora.

Após a liberação, o teste verifica resposta bem-sucedida, valor de domínio incrementado para exatamente 1, uma linha de efeito e uma chave de idempotência persistidas. Assim, a espera ocorre dentro do efeito, não apenas na aquisição da chave; não há assertion baseada somente em tempo ou mensagem. Execução dedicada: 1/1 passou. A integração completa default e serial também incluiu o teste e passou 53/53 em cada modo. A confirmação técnica independente anterior da correção A2 consta em `PHASE1_RUNNER_A2_RESOLUTION.md`; não se afirma aqui que esta execução local foi feita por uma sessão de agente separada.

## Resultado da revalidação dos achados

| Achado                                                   | Estado atual                    | Evidência e limite                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 — processo cai por erro de pool ocioso (P1)           | Corrigido e validado localmente | API/worker reais, conexões ociosas, outage/restauração, polling retomado, jobs processados uma vez e shutdown durante outage; regressão 3/3 em três execuções consecutivas. CI remoto e infraestrutura gerenciada não testados. |
| A2 — lock de negócio classificado como conflito da chave | Corrigido e validado localmente | Teste PostgreSQL dedicado e suíte completa default/serial; sem endpoint comercial consumindo o helper ainda.                                                                                                                    |
| A3 — perda de centavo no limite                          | Corrigido e validado            | Testes de limite e negativo, unitários completos.                                                                                                                                                                               |
| A4 — offset fixo aceito como fuso IANA                   | Corrigido e validado            | Teste negativo de offset fixo e unitários completos.                                                                                                                                                                            |
| A5 — prévia sem aviso de dados fictícios                 | Corrigido e validado            | Aviso explícito e build completo.                                                                                                                                                                                               |

## Gates locais

- `pnpm lint` — passou.
- `pnpm format:check` — passou.
- `pnpm typecheck` — passou.
- `pnpm test` — 16/16, passou.
- `pnpm test:integration` — 53/53, passou; o runner aplicou migrations e executou `db:check` em PostgreSQL descartável.
- `pnpm --filter @arenahub/api test:integration --maxWorkers=1 --reporter=dot` — 53/53, passou.
- `pnpm build` — passou.
- `git diff --check` — passou.

O encerramento anterior do fork Vitest com código Windows `0xC0000409` permanece sem causa comprovada. A consulta local de eventos não encontrou evento de WER/Application Error correspondente; duas execuções completas posteriores (default e serial) passaram. Não há base para atribuir o episódio a uma dependência ou tecnologia específica. O workflow Linux foi posteriormente confirmado no SHA `c1ad42c332d3dc6ef5fcdeaa12a2a83e34bb8f70`, conforme abaixo.

### CI remoto e correção do teste concorrente

As duas execuções do workflow no SHA `4fba73ba52ceabbb35d5a7a791fea0eb64cb2636` falharam na mesma assertion de `jobs.integration.test.ts`: esperava seis jobs observados, mas após 5 s havia quatro. `db:check`, A2 e os três cenários de outage passaram no Linux; o build foi pulado porque a etapa de integração falhou. O teste concorrente isolado local completou os seis jobs em 6,11 s, confirmando que seu limite interno antigo (5 s) era menor que o tempo observado com o polling padrão de 2 s.

A correção somente aumentou a espera interna para no máximo 15 s e o timeout total do teste para 30 s, manteve as assertions de seis jobs e IDs distintos e adicionou estados persistidos à mensagem de falha. A execução isolada e a suíte local completa (53/53) passaram depois da mudança.

CI final: [GitHub Actions, execução 45932228283](https://github.com/Alanls-mx/ArenaHub/actions/runs/45932228283), SHA `c1ad42c332d3dc6ef5fcdeaa12a2a83e34bb8f70`, `ubuntu-latest`, Node 24.22.3, pnpm 11.25.0. Job `verify` passou: instalação congelada, geração Prisma, lint, formatação, typecheck, unitários, verificação do Docker, integração (53/53, incluindo os três cenários de processo real e A2), `db:check` no runner descartável e build. O workflow emitiu aviso de manutenção: as actions `checkout@v4`, `setup-node@v4` e `pnpm/action-setup@v4` têm runtime Node 20 depreciado e foram forçadas a Node 24; o job terminou com sucesso.

## Estado do gate

**FASE 1 TECNICAMENTE APROVADA — PENDÊNCIAS COMERCIAIS. O gate integral continua aberto.** Permanecem pendentes: 3 a 5 entrevistas com proprietários, decisões comerciais resultantes e consolidação final de `docs/DATABASE.md` e ERD. O modelo definitivo não deve ser congelado antes das entrevistas. `occupancy_spike` permanece experimental e a Fase 2 não foi iniciada.
