# Acesso da agenda — Fase 4

Toda rota HTTP deriva a organização do slug/host validado pelo backend. `run()` em `booking/routes.ts` revalida sessão, membership ativa e capability em cada requisição, abre transação e passa `organization_id` ao serviço. Um recurso de outra arena responde `404`. A Web consulta `/access` para mostrar apenas as ações autorizadas; isso é apresentação, não substitui o controle da API.

| Operação                                          | Capability                             | Staff | Owner |
| ------------------------------------------------- | -------------------------------------- | ----- | ----- |
| Agenda, disponibilidade e detalhe                 | `reservations.read`                    | Sim   | Sim   |
| Criar reserva                                     | `reservations.create`                  | Sim   | Sim   |
| Confirmar, remarcar, cancelar, no-show, concluir  | capability específica `reservations.*` | Sim   | Sim   |
| Criar e remover bloqueio                          | `schedule_blocks.manage`               | Não   | Sim   |
| Ler mensalistas                                   | `recurrences.read`                     | Não   | Sim   |
| Criar, estimar primeiro mês e gerenciar contratos | `recurrences.manage`                   | Não   | Sim   |
| Isentar política comercial                        | `commercial_policy.override`           | Não   | Sim   |

O WebSocket valida Origin, cookie, host, membership e `reservations.read` na conexão. Revalida sessão, membership e capability antes de cada invalidação e periodicamente. Revogação fecha o canal com código `1008`; a sessão global e acessos a outras arenas permanecem válidos.

O teste `booking.integration.test.ts` cobre leitura cruzada, referência a cliente estrangeiro, Staff impedido de bloquear/isentar e fechamento do canal após revogação. FKs tenant e filtros SQL explícitos protegem persistência e leitura; a exclusion constraint protege ocupação física, independentemente da autorização.
