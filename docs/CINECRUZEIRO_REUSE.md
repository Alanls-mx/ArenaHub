# Reaproveitamento do Cine Cruzeiro

Referência consultada em modo somente leitura: `Alanls-mx/CineCruzeiro`, commit `f7c3e27f420897ef2e051713f4b9a7e79f1bd742`. Não foi encontrada licença de código na raiz da cópia consultada; por isso nenhum trecho de código ou asset foi copiado.

| Origem inspecionada                                                                     | Classificação    | Aplicação no ArenaHub                                                                                                          | Evidência                      |
| --------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `scripts/with-local-disposable-postgres.js`, `scripts/with-isolated-postgres.js`        | ADAPTAR conceito | Runner próprio em `apps/api/scripts/run-integration.mjs`: Testcontainers, nome aleatório, marcador e encerramento em `finally` | `pnpm test:integration`        |
| `tests/test-postgres-safety.test.mjs`, `tests/local-disposable-postgres-guard.test.mjs` | ADAPTAR casos    | Validação de URL e ausência de fallback em `disposable-database.test.ts`                                                       | `pnpm test`                    |
| `tests/calendar-date.test.mjs`, `scripts/session-timezone-tests.js`                     | REFERÊNCIA       | Casos de data civil e fuso em `shared/time/time.test.ts`; regras específicas de cinema excluídas                               | `pnpm test`                    |
| `scripts/check-architecture-map.mjs`                                                    | REFERÊNCIA       | Regras de importação ESLint, sem copiar o mapa legado                                                                          | `pnpm lint`                    |
| Servidor e painel legados, fluxos de ingresso/crédito, JSON, WebSocket                  | REJEITAR         | Arquitetura e domínio incompatíveis                                                                                            | Inspeção do README e estrutura |

O Cine Cruzeiro não é dependência de runtime ou build do ArenaHub.
