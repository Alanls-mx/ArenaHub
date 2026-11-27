# Gate da Fase 2

Branch local feat/phase-2-identity-access, baseada no merge be96251. A aprovação da Fase 1 corresponde a outro commit.

O fluxo de equipe liga a página inicial Next.js ao proxy /api/v1, contratos compartilhados, Fastify, sessões e transações em arena_identity. As rotas públicas de recuperação e convite enviam links pela configuração SMTP. As provas de ocupação e a fila conservam schemas separados. O CLI org:create recebe o JSON de provisionamento por stdin.

A [matriz de endpoints](PHASE2_ACCESS.md) e o [ADR-010](decisions/ADR-010-product-and-access.md) descrevem os limites de autorização, as decisões do fundador e as fases comerciais. As verificações locais e o veredito estão registrados abaixo.

## Veredito em 27/11/2026

**Fase 2 aprovada localmente.** O CI remoto da Fase 2 aguarda publicação da branch. O resultado do PR #1 pertence à fundação.

| Verificação local                                    | Evidência                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, Prettier, TypeScript, build e git diff --check | Aprovados                                                                                                                                                                                                                 |
| Testes unitários                                     | 18 de 18 em cinco arquivos                                                                                                                                                                                                |
| Integração                                           | 58 de 58 em dez arquivos, incluindo as regressões da Fase 1 e os cinco cenários compostos de identidade                                                                                                                   |
| Migrations e db:check                                | Seis migrations aplicadas em PostgreSQL 16 descartável, três delas novas. Comparações Prisma sem divergência em occupancy_spike e arena_identity. FKs de cargos e catálogo conferidos                                     |
| Navegador e e-mail                                   | Build Next.js com proxy para Fastify, PostgreSQL e Mailpit descartáveis. Chrome autenticou pelo teclado, selecionou outra arena, abriu o editor, aceitou convite recebido por SMTP e voltou a entrar com senha recuperada |
| Layout                                               | Editor visível e largura do documento dentro do viewport em [1440 × 900](evidence/phase2/1440x900.png), [768 × 1024](evidence/phase2/768x1024.png) e [390 × 844](evidence/phase2/390x844.png)                             |

## Integridade e isolamento demonstrados

Em duas tentativas simultâneas de remover a própria propriedade, uma retornou 200 e a outra 409. O banco recusou remover o último Owner e desativar sua identidade por SQL direto. A auditoria resistiu à exclusão direta. A suíte verificou escopo e sessão nas rotas da organização, cargo de outra arena, alteração acima da autoridade de delegação e autopromoção. Revogar uma membership bloqueou a arena na próxima requisição e preservou acesso à segunda com a mesma sessão.

A aplicação usa Argon2id, token opaco em cookie, hash no banco, verificação da origem e CSRF nas mutações autenticadas. Alteração de senha substitui as sessões. Recuperação consome token e revoga as sessões existentes. O teste local exercitou o transporte SMTP e o processamento pelo navegador.

## Pendências para etapas posteriores

Selecionar o serviço SMTP de produção e verificar entregabilidade no domínio real. Antes do piloto, avaliar os papéis PostgreSQL, RLS e desempenho com volume representativo conforme ADR-002. As fases de agenda e financeiro dependem dos detalhes da política central de cancelamento, da base e arredondamento do primeiro mês proporcional e da homologação do Pix Mercado Pago por recebedor. As entrevistas seguem programadas para quando o produto estiver demonstrável.

## Revalidação independente da Fase 2 — 27/11/2026

O [relatório de auditoria direcionada](PHASE2_AUDIT.md) verificou as 12 decisões oficiais e corrigiu a omissão da fundação de domínios por arena. O fluxo atualizado é navegador → proxy Next → resolução do host público no Fastify → sessão, membership e capabilities → PostgreSQL e auditoria. Host desconhecido ou de outra arena recebe 404; o cabeçalho encaminhado só é aceito do proxy e IP configurados. A ativação operacional de domínios próprios permanece futura.

**Veredito local revalidado: APROVADO TECNICAMENTE EM AMBIENTE LOCAL.** Não há P0/P1 remanescente conhecido. CI remoto da branch ainda pendente; o encerramento definitivo aguarda essa prova no SHA publicado.

| Gate da revalidação                      | Resultado                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Unitários                                | 19/19                                                                                                  |
| Integração                               | 59/59 em dez arquivos                                                                                  |
| Migrations                               | Sete aplicadas em PostgreSQL 16 descartável; quatro da Fase 2, incluindo domínios                      |
| `db:check`                               | Sem drift Prisma; triggers de Owner/auditoria, FKs, catálogo e índice de hostname verificados          |
| Visual                                   | Next, Fastify, Chrome, PostgreSQL e Mailpit; desktop 1440 × 900, tablet 768 × 1024 e celular 390 × 844 |
| Lint, formatação, typecheck, build, diff | Aprovados                                                                                              |

A auditoria original da Fase 1 e o gate anterior permanecem como registros históricos. Na preparação para publicação, `checkout`, `pnpm/action-setup` e `setup-node` foram atualizadas para v5, cujo runtime é Node 24; a eficácia dessa manutenção depende do CI remoto. O PR da Fase 2 ainda não havia sido publicado nesta revalidação local.

## Encerramento técnico após publicação — 27/11/2026

**FASE 2 CONCLUÍDA — IDENTIDADE, AUTENTICAÇÃO E CONTROLE DE ACESSO APROVADOS.** A classificação resulta da aprovação local, da [auditoria direcionada](PHASE2_AUDIT.md), dos checks da branch e do CI da `main` após o merge tradicional do [PR #2](https://github.com/Alanls-mx/ArenaHub/pull/2). Não representa deploy nem ativação comercial de domínios próprios.

| Etapa           | Evidência efetiva                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aprovação local | 19/19 unitários, 59/59 integrações, sete migrations e `db:check` em PostgreSQL descartável, sem drift Prisma; lint, formatação, typecheck, build e `git diff --check` aprovados. Next, Fastify, Chrome e Mailpit passaram no teste visual nas três resoluções. |
| Auditoria       | Achados P1 resolvidos; nenhum P0/P1 remanescente conhecido. Decisões do fundador e limites dos domínios registrados em ADR-010 e ADR-011.                                                                                                                      |
| CI da branch    | SHA `4bdc63e7fff1f7e6403dfde705a4c4000fc50c12`: [push](https://github.com/Alanls-mx/ArenaHub/actions/runs/46068302104) e [PR](https://github.com/Alanls-mx/ArenaHub/actions/runs/46068364696) aprovados em Linux.                                              |
| Merge           | PR #2 mesclado pelo método tradicional; merge commit `5544dfbc9034c51b061e33646e97a8d6f9fc89a6`.                                                                                                                                                               |
| CI da main      | [Run 46068697453](https://github.com/Alanls-mx/ArenaHub/actions/runs/46068697453) aprovado no merge commit.                                                                                                                                                    |

O workflow remoto executou instalação com lockfile congelado, geração Prisma, lint, formatação, typecheck, unitários, Docker/Testcontainers, migrations, `db:check`, integração e build. A automação com Chrome/Mailpit é uma verificação **local**, não parte do workflow remoto. A atualização pontual das três Actions para v5 funcionou nos três runs remotos; o aviso histórico de Node 20 foi tratado.

Permanecem fora do gate técnico da Fase 2: SMTP de produção, papéis PostgreSQL de runtime e reavaliação de RLS antes do piloto, login operacional entre domínios independentes, DNS/TLS, detalhes da política central de cancelamento, fórmula definitiva do primeiro mês proporcional e homologação Mercado Pago por recebedor. Nenhuma funcionalidade da Fase 3 foi iniciada.
