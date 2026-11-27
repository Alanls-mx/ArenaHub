# Auditoria independente da Fase 1 — 26/11/2026

## 1. Resumo executivo

**Veredito técnico: REPROVADO TECNICAMENTE.** Há um defeito operacional P1 reproduzido: após uma consulta deixar uma conexão ociosa no `pg.Pool`, a queda do PostgreSQL emite um evento `error` sem listener e encerra o processo Node. A API usa esse pool na readiness; o worker usa outro pool na limpeza de chaves. A suíte de recuperação valida o pool do pg-boss, mas não esses dois pools. Assim, a retomada automática do worker real não está demonstrada para o ciclo que executou limpeza, e a API pode cair após uma checagem de readiness.

**Gate integral da Fase 1: aberto.** Além do P1, faltam CI remoto efetivamente executado e três a cinco entrevistas comerciais. A Fase 2 não está liberada por este parecer. Este relatório não altera a implementação nem os dados do projeto.

## 2. Escopo auditado

Foram examinados `AGENTS.md`, `README.md`, documento mestre v3.2, documentação do gate, contexto, banco, testes, segurança, reaproveitamento, visual, entrevistas, ADRs 002–007, manifests e lockfile, workflow CI, migrations, scripts, código e testes de API, worker, bibliotecas de tempo/dinheiro, isolamento, ocupação, idempotência e prévias web. O estado e o diff Git foram inspecionados; alterações locais anteriores foram preservadas. Não foram usados bancos reais.

## 3. Evidências verificadas

- O runner de integração cria PostgreSQL Testcontainers com nome e credenciais de teste, aplica três migrations, roda `db:check` e encerra o container. Não há fallback para `DATABASE_URL` de desenvolvimento. O verificador confirmou ausência de drift Prisma e garantias SQL, incluindo `tstzrange` gerado e exclusão; testes negativos detectam alterações nessas garantias.
- Os testes de concorrência usam conexões independentes e barreiras explícitas. A matriz experimental multi-tenant cobre queries de primeiro nível, nested writes, `connect`, `upsert`, SQL manual, agregações, views, transações, referências cruzadas e reuso de pool; o spike RLS usa papel sem bypass e contexto transacional.
- A suíte de outage manteve porta, URL, container e dados; reiniciou o PostgreSQL real. O job ativo demonstrou efeito único, porém usa `PgBoss` diretamente. O runtime `startWorker` foi exercitado nos cenários ociosos e de inicialização, sem executar o job de limpeza antes da queda.
- Reproduzi separadamente a falha do `pg.Pool` sem listener em PostgreSQL descartável: após `SELECT 1` e `container.restart()`, o processo filho saiu com **código 1** e `Unhandled 'error' event`. Isso confirma a falha de ciclo de vida dos pools da aplicação. A [documentação do node-postgres](https://node-postgres.com/apis/pool) exige listener para erros de clientes ociosos.
- As prévias foram abertas em 390 px e 1440 px. Não houve overflow do documento; a tabela móvel tem rolagem própria. O diálogo recebeu foco, foi rotulado e fechou com Escape. A agenda informa “dados fictícios”; a prévia do tema não traz esse aviso explícito.

## 4. Achados ordenados por severidade

### A1 — Pool ocioso encerra API ou worker em outage (P1; bloqueia Fase 2)

- **Arquivos/linhas:** `apps/api/src/app.ts:22–40`; `apps/api/src/shared/jobs/index.ts:24–36,84–86`; cobertura em `apps/api/src/shared/jobs/jobs-outage.integration.test.ts:75–173,181–305`.
- **Evidência:** os dois `new Pool` não possuem listener `error`; somente `boss.on('error')` existe. Reprodução independente com o mesmo driver e PostgreSQL descartável: `SELECT 1`, conexão devolvida ao pool, restart do container, processo encerra com código 1 por evento `error` não tratado.
- **Esperado:** falha transitória degrada readiness/consumo e o processo continua vivo para recuperar.
- **Observado:** o evento de erro do cliente ocioso não é tratado e o processo Node termina. O teste de job ativo usa `PgBoss` diretamente; o runtime testado não executa `cleanExpiredIdempotency` antes do outage.
- **Impacto:** indisponibilidade da API após readiness e do worker após limpeza; recuperação automática depende de supervisor externo e contradiz a garantia local publicada.
- **Reprodução:** iniciar um `pg.Pool` sem listener, executar `SELECT 1`, devolver o cliente e reiniciar um PostgreSQL Testcontainers na mesma porta; observar exit 1. Para regressão de produto, repetir com `/api/v1/health/ready` e com `startWorker` após um job de limpeza.
- **Correção recomendada:** instalar handlers `pool.on('error', ...)` antes do primeiro uso, registrar erro sem credenciais, refletir degradação quando pertinente e testar queda/retorno com ambos os runtimes reais e pools já aquecidos.

### A2 — Timeout de lock de negócio vira conflito de idempotência (P2; não bloqueia sozinho)

- **Arquivo/linhas:** `apps/api/src/shared/idempotency/index.ts:82–83,129–145`; `docs/PHASE1_GATE.md:23`.
- **Evidência:** `SET LOCAL lock_timeout = '5s'` vale para toda a transação, inclusive `effect(client)`. O `catch` converte qualquer SQLSTATE `55P03` em `IDEMPOTENCY_IN_PROGRESS`, sem identificar a query que falhou.
- **Esperado:** somente espera pela mesma chave esgotada recebe esse código; timeout de lock no efeito preserva sua causa e política própria de retry.
- **Observado:** pelo fluxo do código, um lock de negócio que ultrapasse 5 s também retorna 409 de chave em andamento. A auditoria não executou um endpoint de domínio, pois ainda não existe.
- **Impacto:** diagnóstico enganoso e retry indevido quando efeitos futuros disputarem linhas de domínio.
- **Reprodução:** em teste descartável, segurar um lock de linha em outra conexão por mais de 5 s e chamar `executeIdempotent` com um `effect` que precise dessa linha; verificar `IDEMPOTENCY_IN_PROGRESS` apesar de chave inédita.
- **Correção recomendada:** limitar o `lock_timeout` à aquisição da chave, restaurá-lo antes do efeito, e classificar `55P03` conforme a fase da operação; adicionar teste de lock no efeito.

### A3 — Formatação de centavos perde precisão no limite aceito (P2; não bloqueia sozinho)

- **Arquivo/linhas:** `apps/api/src/shared/money/index.ts:2–8,31–32`; `apps/api/src/shared/money/money.test.ts:22`.
- **Evidência:** `cents` aceita `Number.MAX_SAFE_INTEGER`, mas `formatBRL` divide por 100 em `number`. Execução local: `formatBRL(cents(Number.MAX_SAFE_INTEGER))` produziu `R$ 90.071.992.547.409,90`; os centavos inteiros são `90.071.992.547.409,91`.
- **Esperado:** apresentar exatamente os centavos aceitos pelo tipo.
- **Observado:** perda de R$ 0,01 nesse extremo. O teste cobre apenas R$ 123,45.
- **Impacto:** apresentação financeira inexata para valores grandes; cálculos inteiros permanecem corretos.
- **Reprodução:** executar `formatBRL(cents(Number.MAX_SAFE_INTEGER))` e comparar com a decomposição inteira por 100.
- **Correção recomendada:** formatar parte inteira e centavos a partir de `bigint`/inteiros, sem converter o valor total em reais flutuantes; testar limites e negativos.

### A4 — Validação de fuso aceita offset fixo como IANA (P2; não bloqueia sozinho)

- **Arquivo/linhas:** `apps/api/src/shared/time/index.ts:5–12,22–29`; `apps/api/src/shared/time/time.test.ts:25–26`; `docs/decisions/ADR-007-time-library.md`.
- **Evidência:** `validateTimeZone('+03:00')` retornou `+03:00` em execução local. `Temporal.Now.zonedDateTimeISO` aceita offset fixo; a função e o contrato do produto pedem fuso IANA.
- **Esperado:** aceitar `America/Sao_Paulo`/`UTC` e rejeitar offset fixo como configuração de arena.
- **Observado:** `+03:00` passa, eliminando regras históricas e futuras de horário civil da localidade.
- **Impacto:** recorrências configuradas com offset fixo podem divergir do horário local esperado em zonas com mudanças de offset.
- **Reprodução:** chamar `validateTimeZone('+03:00')`.
- **Correção recomendada:** validar identificadores nomeados IANA antes da conversão e acrescentar teste negativo de offset fixo.

### A5 — Documento afirma aviso explícito nas duas prévias (P3; não bloqueia)

- **Arquivo/linhas:** `docs/PHASE1_GATE.md:29`; `apps/web/src/app/theme-preview/page.tsx:5–8`; `apps/web/src/app/agenda-preview/page.tsx:7`.
- **Evidência:** a agenda traz “dados fictícios”; o tema diz “Prévia técnica” e usa exemplos, sem aviso explícito de dados fictícios.
- **Esperado:** documentação corresponder ao que a interface mostra.
- **Observado:** a afirmação “as duas prévias mantêm aviso” não se confirma na prévia do tema.
- **Impacto:** divergência documental pequena, sem indício de dados reais.
- **Reprodução:** abrir `/theme-preview` e comparar com `/agenda-preview` e o gate.
- **Correção recomendada:** adicionar aviso curto à prévia do tema ou ajustar a afirmação documental.

## 5. Matriz de requisitos

| Área                                      | Resultado da auditoria                                                                      | Limite                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Banco, migrations e constraints           | Comprovado no PostgreSQL descartável, inclusive `db:check` e testes negativos               | Modelo definitivo ainda depende das entrevistas                   |
| Ocupação concorrente e múltiplas unidades | Testes usam conexões independentes e exercitam atomicidade experimental                     | `occupancy_spike` não é schema final                              |
| Isolamento multi-tenant e RLS             | Spike comprova limites de Prisma e defesa adicional RLS                                     | Endpoints, memberships e papéis globais serão definidos na Fase 2 |
| Idempotência                              | Aquisição, replay, rollback e efeito na transação verificados                               | A2; nenhum endpoint comercial usa o helper ainda                  |
| Tempo e dinheiro                          | Conversões, ambiguidade, overflow e operações inteiras têm testes                           | A3 e A4                                                           |
| Worker e outage                           | Persistência/restart do pg-boss e efeito único verificados                                  | A1 impede aprovar recuperação do processo completo                |
| Segurança/API                             | Helmet, redaction, erros e health endpoints presentes                                       | A1 na readiness; autenticação e CSRF são futuras                  |
| Visual                                    | Layout, foco, Escape e responsividade verificados localmente                                | A5; leitor de tela integral não testado                           |
| CI                                        | Workflow contém gates e Docker sem `continue-on-error`                                      | Execução remota pendente                                          |
| Cine Cruzeiro                             | Reuso documentado de conceitos e padrões, sem dependência de runtime ou persistência legada | Não foi executado outro projeto                                   |

## 6. Resultados dos testes

| Comando/cenário                         | Resultado local desta auditoria                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`                             | Aprovado                                                                                        |
| `pnpm format:check`                     | Aprovado                                                                                        |
| `pnpm typecheck`                        | Aprovado                                                                                        |
| `pnpm test`                             | 16/16, 4 arquivos, 609 ms                                                                       |
| `pnpm test:integration`                 | 49/49, 8 arquivos, 41,59 s; migrations e `db:check` incluídos                                   |
| `pnpm db:check`                         | Aprovado dentro do runner contra banco descartável; Prisma sem drift e verificador SQL aprovado |
| `pnpm build`                            | Aprovado, incluindo páginas web                                                                 |
| `git diff --check`                      | Aprovado; aviso de finais CRLF em `.prettierignore`                                             |
| Suíte `jobs-outage.integration.test.ts` | Três execuções consecutivas, 2/2 em cada: 19,88 s; 20,18 s; 19,16 s                             |

Nos três ciclos, o job ativo retomou em aproximadamente 1747, 2116 e 1773 ms; os ciclos ociosos ficaram entre 3807 e 3832 ms. São observações locais, sem promessa de SLA. A reprodução adicional do pool não foi incorporada à suíte e não altera o repositório.

## 7. Riscos residuais

PostgreSQL gerenciado/proxy, falhas longas e carga representativa não foram ensaiados; isso não é requisito para o parecer local. A adoção de RLS precisa de medição e desenho de papéis worker/admin. Os testes de isolamento pertencem ao spike e devem ser repetidos nos endpoints comerciais. O repositório contém alterações locais de fases anteriores ainda não publicadas; o CI remoto não pode ser inferido do resultado local.

## 8. Divergências entre código e documentação

O gate e o ADR-006 dizem que o worker retoma sem intervenção manual, mas essa garantia não cobre o pool de limpeza aquecido (A1). O gate afirma aviso de dados fictícios nas duas prévias; só a agenda o apresenta literalmente (A5). A documentação de idempotência descreve 409 por espera na chave, enquanto o código também pode emiti-lo por lock no efeito (A2).

## 9. Avaliação do ADR-002

A conclusão de que `forTenant(ctx)` não é barreira de segurança é correta. As FKs compostas limitam referências cruzadas, mas não filtram uma consulta sem predicado. A matriz negativa e o spike RLS justificam considerar RLS na Fase 2, sem antecipá-lo obrigatoriamente no banco experimental. Não identifiquei um novo vazamento no caminho escopado do spike; isso não aprova endpoints ou membership futuros.

## 10. Avaliação do ADR-006

A causa anterior da mudança de porta em `Testcontainers.restart()` foi corrigida com porta publicada fixa, e a URL permanece igual. Os testes demonstram persistência, indisponibilidade real, job retomado e ausência de duplicação no efeito sintético. O ADR extrapola essa evidência para o processo completo: o `pg.Pool` de limpeza não tem listener e a suíte não o aquece antes da queda. A1 requer correção e regressão antes de reafirmar retomada automática local.

## 11. Pendências de CI

O workflow fixa Node 24, usa pnpm/lockfile congelado, gera Prisma Client, executa lint, formatação, typecheck, unitários, integração com Docker/Testcontainers, `db:check` dentro do runner e build. Não encontrei `continue-on-error` ou skip explícito dos gates. Falta executar e observar o job remoto nesta versão; portanto, CI remoto permanece não validado.

## 12. Pendências comerciais

Faltam três a cinco entrevistas com donos de arenas. Políticas de mensalidade, remarcação, cancelamento/no-show, cobrança e disponibilidade não devem ser congeladas com base nas fixtures do spike. O roteiro em `docs/INTERVIEWS.md` está disponível.

## 13. Recomendação

**REPROVADO TECNICAMENTE** até tratar A1 e demonstrar o processo real da API e do worker atravessando uma queda de PostgreSQL após uso de seus pools. A2–A5 são correções recomendadas, mas não justificam por si só reprovação. Após a correção, repetir os gates locais e a suíte de outage, atualizar ADR-006/gate conforme a evidência e executar o CI remoto. Mesmo com aprovação técnica local posterior, o **gate integral da Fase 1** segue aberto até CI remoto e entrevistas comerciais.
