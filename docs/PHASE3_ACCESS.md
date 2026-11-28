# Acesso da Fase 3

Todas as rotas abaixo usam `/api/v1/orgs/:slug`, sessão global válida, host compatível com a arena, membership ativa e CSRF em mutações. O tenant é derivado no backend; recursos externos retornam 404. Owner possui todas as capacidades do catálogo. Um cargo recebe a união das capacidades concedidas; cargos persistidos não ganham capacidades novas automaticamente.

O contrato OpenAPI 3.1 destas rotas está em [OPENAPI_PHASE3.json](OPENAPI_PHASE3.json); schemas de entrada e saída são definidos em `packages/contracts/src/operations.ts`.

| Rotas                                                                                             | Capacidade          | Efeito                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| `GET /customers`                                                                                  | `customers.read`    | Busca por nome, cursor, até 100 itens; contato mínimo        |
| `POST /customers`, `PATCH /customers/:id`                                                         | `customers.manage`  | Cadastro e edição                                            |
| `DELETE /customers/:id`                                                                           | `customers.archive` | Arquivamento reservado ao Owner por padrão                   |
| `GET /sports`                                                                                     | `sports.read`       | Lista paginada                                               |
| `POST /sports`, `PATCH/DELETE /sports/:id`                                                        | `sports.manage`     | Gerencia modalidades; arquivamento em uso é recusado         |
| `GET /venues`, `GET /units`                                                                       | `venues.read`       | Espaços e recursos físicos da arena                          |
| `POST /venues`, `PATCH/DELETE /venues/:id`                                                        | `venues.manage`     | Cria com unidade exclusiva quando simples, edita e arquiva   |
| `POST /units`, `PATCH/DELETE /units/:id`, `PUT /venues/:id/units`                                 | `units.manage`      | Unidades e composição; unidade em uso não pode ser arquivada |
| `GET /venues/:id/operating-hours`, `GET /calendar-exceptions`                                     | `hours.read`        | Horários e exceções                                          |
| `PUT /venues/:id/operating-hours`, `POST /calendar-exceptions`, `DELETE /calendar-exceptions/:id` | `hours.manage`      | Semana inteira e exceções                                    |
| `GET /pricing-rules`                                                                              | `pricing.read`      | Regras, inclusive arquivadas para histórico                  |
| `POST/PATCH/DELETE /pricing-rules`                                                                | `pricing.manage`    | Cria, edita e arquiva sob lock do venue                      |
| `GET /pricing/quote`                                                                              | `pricing.simulate`  | Cálculo sem efeitos comerciais                               |
| `GET /domains`, `POST /domains/requests`                                                          | `domains.manage`    | Lista e solicita hostname próprio em estado pendente         |

Templates para novas organizações: Administrador recebe o catálogo exceto `integrations.manage`, `customers.archive` e `domains.manage`; Gerente e Staff recebem leitura da estrutura, clientes básicos e simulação, além das capacidades anteriores. Staff não recebe edição de espaços, horários ou preços. Arquivamento de clientes e solicitação de domínio ficam somente com Owner por padrão. Gestão de configurações gerais continua somente com Owner. Domínio solicitado não é ativado, verificado nem mostrado como acessível ao público.

Erros de validação são 400; falta de sessão 401; falta de capability 403; membership ou recurso alheio 404; conflito de unicidade, composição ou preço 409. Alterações administrativas são auditadas na mesma transação. A simulação não gera auditoria nem escrita de domínio.
