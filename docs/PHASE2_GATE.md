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
