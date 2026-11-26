# Gate da Fase 1 — 26/11/2026

**Estado: PARCIALMENTE CONCLUÍDA.** O gate técnico avançou, mas a matriz completa de isolamento, testes operacionais do worker e entrevistas comerciais ainda faltam. Nenhum deploy ou congelamento de banco está autorizado por este documento.

| Requisito                                     | Estado                                         | Evidência ou pendência                                                                          |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ESLint, Prettier, TypeScript strict, build    | IMPLEMENTADO E VALIDADO                        | Comandos locais e CI configurados                                                               |
| Banco descartável separado do desenvolvimento | IMPLEMENTADO E VALIDADO                        | Testcontainers, marcador e guard; `pnpm test:integration`                                       |
| Ocupação e constraints SQL                    | IMPLEMENTADO E VALIDADO no spike               | 13 testes de ocupação/catálogo, drift e `check-schema.mjs`                                      |
| Isolamento tenant                             | PARCIALMENTE IMPLEMENTADO                      | Extensão cobre leituras comuns; SQL e escrita contornam; matriz restante descrita no ADR-002    |
| Biblioteca temporal e monetária               | IMPLEMENTADO E VALIDADO para primitivas atuais | Testes unitários; regras de preço finais ausentes                                               |
| Idempotência transacional                     | PARCIALMENTE IMPLEMENTADO                      | Migration, concorrência e timeout testados; integração HTTP e armazenamento de falhas pendentes |
| Worker PostgreSQL                             | PARCIALMENTE IMPLEMENTADO                      | pg-boss, execução, recuperação, retry e dois workers testados; falha de banco pendente          |
| Segurança HTTP e health                       | PARCIALMENTE IMPLEMENTADO                      | Helmet, redaction, timeout, readiness e liveness; autenticação/CSRF/proxy de produção pendentes |
| Componentes e tokens                          | IMPLEMENTADO SEM VALIDAÇÃO VISUAL MANUAL       | Preview do tema e agenda estática compilados                                                    |
| CI com PostgreSQL real                        | IMPLEMENTADO SEM VALIDAÇÃO REMOTA              | Workflow usa Testcontainers; requer execução no GitHub após push autorizado                     |
| Entrevistas com proprietários                 | BLOQUEADO                                      | Usuário informou que ainda não existem; roteiro preparado                                       |
| Modelo final de banco                         | NÃO IMPLEMENTADO                               | Fases seguintes; depende de entrevistas e matriz de isolamento                                  |

## Próximos critérios para fechar o gate

1. Completar matriz de operações tenant do ADR-002; decidir RLS com evidências.
2. Cobrir falha de banco durante execução, além de integração de idempotência na camada HTTP.
3. Validar preview visual e acessibilidade em navegador.
4. Executar workflow no GitHub após autorização para publicar as alterações.
5. Realizar três a cinco entrevistas, rastrear decisões e só então congelar `DATABASE.md`.
