# Gate da Fase 1.2 — 26/11/2026

**Estado: implementação técnica local validada; gate integral aberto.** A Fase 1.1 aprovou 16 testes unitários e 46 de integração, mas não comprovou retomada após reinício completo do PostgreSQL. A Fase 1.2 corrigiu o experimento e demonstrou a recuperação local. CI remoto e três a cinco entrevistas ainda faltam. A Fase 2 não está liberada; `occupancy_spike` continua experimental.

## Pendências técnicas e evidências

| Área                     | Resultado local                                                                                                                                                                                           | Limite atual                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Isolamento multi-tenant  | `TenantContext` obrigatório; repository com operações escopadas; matriz negativa com duas organizações em PostgreSQL descartável                                                                          | Ainda não há endpoints nem identidade para provar revalidação de membership por requisição |
| RLS                      | Spike isolado com papéis distintos, `FORCE ROW LEVEL SECURITY`, `USING`/`WITH CHECK`, `set_config(..., true)`, pool reutilizado, Prisma, SQL e view `security_invoker`                                    | Não está no schema definitivo; faltam benchmark e desenho de worker/admin global           |
| Idempotência             | Aquisição, efeito e resposta na mesma transação; payload canônico; escopo usuário/organização; concorrência real, rollback e limpeza testados; espera de até 5 s e `Retry-After: 1`                       | Integração HTTP é da tradução de erro; nenhum endpoint de domínio usa o helper ainda       |
| Worker                   | Inicialização com banco parado, reinício ocioso e durante job, dois ciclos de outage, efeito único, shutdown e estado do consumidor testados no mesmo banco descartável                                   | CI remoto, PostgreSQL gerenciado e carga de produção não validados                         |
| Ambiente de testes e SQL | Testcontainers descartável, migrations experimentais, guard obrigatório e `db:check` real no runner; testes negativos detectam constraint e coluna gerada alteradas                                       | Não usar `DATABASE_URL` de desenvolvimento em checks destrutivos                           |
| Visual                   | Tema e agenda fictícia inspecionados em 1440×900, 768×1024 e 390×844; sem overflow do documento, foco e estados textuais verificados                                                                      | Auditoria integral com leitor de tela ainda não executada                                  |
| CI                       | Workflow inclui Node 24 LTS, pnpm 11.25.0, lockfile congelado, Prisma Client, lint, format, typecheck, unitários, integração com Testcontainers e build; `db:check` roda dentro da integração descartável | Workflow ainda não foi executado no GitHub para estas alterações                           |

## 1. Matriz multi-tenant e RLS

A matriz completa, classificação de cada operação e comandos reproduzíveis estão em [ADR-002](decisions/ADR-002-tenant-isolation.md). O `forTenant` auxilia somente leituras de primeiro nível. Repositories com predicados explícitos e FKs compostas protegeram os caminhos autorizados do spike; client direto, SQL manual e view comum conseguiram atravessar organizações em testes negativos. A alternativa com RLS fez consultas sem contexto válido falharem fechadas, inclusive em conexão reutilizada. Recomenda-se RLS como defesa adicional explícita na Fase 2, junto com autenticação, autorização, repositories e FKs. Antes da adoção, medir desempenho com dados representativos e definir papéis e operações globais.

## 2. Idempotência e worker

O PostgreSQL faz a segunda inserção de chave concorrente esperar a primeira transação. Se a primeira confirma, a segunda reproduz a resposta; se excede o `lock_timeout` de 5 segundos, a transação abortada é revertida antes de retornar `409 IDEMPOTENCY_IN_PROGRESS` com `Retry-After: 1`. Falha ao gravar a resposta reverte também o efeito. A mesma chave com método, rota, parâmetros ou corpo diferente é recusada. Registros expiram após 24 horas e o job horário remove expirados; até a limpeza, a chave expirada é recusada, sem reutilização silenciosa.

O teste do worker com `pg_terminate_backend` interrompeu a conexão do handler. Na Fase 1.2, o reinício completo foi repetido com porta de host fixa; o experimento anterior perdia a URL do banco quando o Testcontainers mudava a porta. O pg-boss retomou o polling sem recriar a instância. Um job ativo, cujo efeito já estava commitado, terminou após retentativa com **um único efeito**. Início com banco indisponível, reinício ocioso, dois ciclos repetidos, shutdown durante falha e cancelamento do startup passaram. A readiness do worker exige polling recente de ambos os consumidores, não apenas conexão SQL. Jobs terminais permaneceram identificáveis. **Execução exatamente uma vez não é prometida**; handlers precisam ser idempotentes. [ADR-006](decisions/ADR-006-postgres-jobs.md) detalha causa, configuração, limites e tempos.

## 3. Visual e compatibilidade

[Evidência visual](VISUAL_VALIDATION.md): as duas prévias mantêm aviso de dados fictícios. Os pares de tokens avaliados superaram 4,5:1; teclado, foco, diálogo e Escape foram inspecionados. Não houve mudança de design necessária.

O workflow fixa Node 24, que consta como LTS na [tabela oficial do Node.js](https://nodejs.org/en/about/previous-releases). O projeto usa TypeScript 6.0.3 e `typescript-eslint` 8.74.0; **não houve downgrade de TypeScript nesta rodada**. A [faixa suportada pelo typescript-eslint](https://typescript-eslint.io/users/dependency-versions/) inclui TypeScript 6.0. Não houve atualização indiscriminada de dependências. O `next-env.d.ts` é gerado pelo Next e foi excluído do Prettier para evitar alteração de formatação em build/dev.

## 4. Verificação e CI remoto

Na Fase 1.2, `pnpm lint`, `pnpm typecheck` e `pnpm build` passaram; `pnpm test` aprovou **16/16** testes e `pnpm test:integration` aprovou **49/49**, incluindo o novo teste de job terminal. `git diff --check` passou. A formatação foi corrigida no próprio gate e verificada novamente. A suíte específica de recuperação passou **três vezes consecutivas**, dois testes por execução. Os ciclos de recuperação medidos foram 3818/3630 ms, 3853/3820 ms e 3836/3627 ms, desde o comando de restauração até o job seguinte ser consumido. `pnpm test:integration` cria banco descartável, aplica migrations e executa `pnpm db:check` nesse banco. Não executar `pnpm db:check` isolado contra dados reais.

Para validar CI remoto, publicar o branch quando autorizado, abrir PR e confirmar no job `verify` a instalação com lockfile, geração Prisma, gates e Testcontainers com Docker. Não houve push, PR, merge ou deploy nesta fase; CI remoto permanece **não validado**.

Arquivos alterados nesta rodada: lifecycle do worker (`apps/api/src/shared/jobs/index.ts`, `apps/api/src/worker.ts`), testes de jobs existentes e nova suíte de outage, runner de integração, workflow CI, este gate, ADR-002, ADR-006, `TESTING.md`, `AI_CONTEXT.md` e `WORKER_OPERATIONS.md`. As alterações locais pré-existentes da Fase 1.1, inclusive `AGENTS.md`, foram preservadas.

## 5. Entrevistas, riscos e liberação

Ainda não existem as três a cinco entrevistas com donos de arenas. Preservar [o roteiro](INTERVIEWS.md). Políticas de mensalidade, remarcação, cancelamento/no-show, cobrança, disponibilidade e fluxo operacional dependem dessas respostas; fixtures do spike não congelam o modelo final.

**Recomendação: não liberar a Fase 2 como gate integralmente concluído.** A recuperação local deixou de ser bloqueio técnico, mas é necessário executar o CI remoto e registrar decisões comerciais das entrevistas. A implementação futura deve repetir a matriz de isolamento por endpoint, estabelecer papéis RLS e medir desempenho antes do piloto.
