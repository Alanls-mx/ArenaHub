# Revisão direcionada da Fase 4 — 28/11/2026

Escopo: apenas o motor de reservas, mensalistas, ocupação física, WebSocket, interface e migration `20261127015000_booking_engine`. A revisão usa código, SQL, testes com PostgreSQL descartável e cenário visual. Pareceres históricos das Fases 1–3 permanecem intactos.

## Achados corrigidos nesta branch

| Severidade | Evidência                                                                                                                        | Correção e verificação                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1         | Resposta HTTP antiga podia substituir uma visão diária/semanal mais nova; disponibilidade podia ficar desatualizada após evento. | Sequência e visão desejada protegem a resposta; atualização da agenda invalida disponibilidade. Cenário visual com dois contextos passou.                                                                 |
| P2         | Rajadas de invalidação em geração recorrente disparavam o limite de 180 requisições/minuto e exibiam 429.                        | Web agrupa invalidações por um segundo e atualiza contratos/conflitos após mutações próprias. O runner falha se observar 429; última execução passou.                                                     |
| P2         | Mensalidade proporcional aparecia apenas após criar o contrato.                                                                  | `GET /recurrence-contracts/first-month-preview` usa a mesma função pura do POST; interface mostra estimativa vinculada aos valores atuais. Teste de integração compara o valor e rejeita dias duplicados. |
| P2         | Recuperação do novo listener `LISTEN` não tinha teste específico.                                                                | Teste derruba a conexão PostgreSQL, aguarda `listener.reconnected`, verifica uma única conexão e nova entrega; também exercita revogação de sessão e mensagem de cliente proibida.                        |

## Garantias verificadas

No mobile de 390 px, o botão de busca de contratos quebrava em duas linhas (P3). O formulário agora reserva largura ao botão e permite que o campo encolha; a nova captura foi inspecionada depois do runner visual passar.

- `organization_id` é derivado no backend; filtros e FKs compostas protegem leituras e referências. Staff não administra bloqueios nem isenta política; sessão e membership são revalidadas no WebSocket.
- Lock compartilhado da organização, locks de venues ordenados e exclusion GiST em unidades físicas protegem reserva, bloqueio e composição divisível. O banco rejeita inserção SQL direta conflitante. Remarcação falha sem alterar a reserva original.
- `Idempotency-Key` e efeito são persistidos na mesma transação. Replay, payload divergente, chave concorrente e confirmação financeira interna foram testados. O resultado comercial é registro, não cobrança.
- Contratos e versões preservam identidade e histórico; constraint exclui sobreposição de versões. Conflitos de ocorrência não impedem as demais. Worker `pg-boss` retoma geração repetida sem duplicar a ocorrência testada.
- `NOTIFY` transacional chega só após commit; rollback não emite sucesso. O payload WebSocket contém tipo e espécie de invalidação, sem cliente, preço, token ou credenciais.
- Um container PostgreSQL descartável com porta fixa foi parado e restaurado: readiness e `LISTEN` recuperaram no mesmo endereço, o WebSocket permaneceu aberto, recebeu `listener.reconnected` e nova invalidação, e a agenda HTTP voltou a responder. O fixture inicial com porta dinâmica mudou de porta após `docker start`; foi descartado como prova de recuperação.
- O cenário visual com Next production, Fastify, PostgreSQL descartável e dois contextos autenticados executou reserva, conflito, confirmação, remarcação, cancelamento, atendimento presencial, mensalista, resolução, versão e encerramento via interface. O segundo contexto recebeu um frame WebSocket real `reservation.changed` antes de atualizar a agenda; essa é a prova visual específica de invalidação pelo canal. O teste de outage e reconexão do listener é separado. Foco e atualização manual também chamam `refresh` na Web, sem serem usados como prova do WebSocket. O intervalo de 60 segundos da interface atualiza o relógio, não consulta a agenda. Tempo automatizado não é medida de usabilidade humana.

## Encerramento da pendência P1 de validação

A pendência original era a ausência de uma disputa simultânea entre **reserva avulsa, geração recorrente e bloqueio administrativo**. O teste dedicado `apps/api/src/booking/three-writers.integration.test.ts` usa os dois endpoints reais e `generateRecurrences` em pool independente. Três sessões HTTP distintas, o pool do gerador e a transação de barreira disputam o mesmo venue completo com duas unidades físicas. A barreira detém o lock de venue; `pg_stat_activity` confirma três PIDs distintos em `wait_event_type='Lock'` antes de liberá-lo. A ordem de entrada dá a cada escritor a primeira posição uma vez, sem alterar os locks de produção.

Comando: `pnpm --filter @arenahub/api test:integration three-writers.integration.test.ts --reporter=verbose`. Três execuções consecutivas em PostgreSQL descartável passaram 3/3 cenários cada. Na ordem reserva/recorrência/bloqueio, as durações dos cenários foram 182/185/200 ms, 176/185/186 ms e 206/184/185 ms. Em todos houve três PIDs em espera, um único vencedor e duas ocupações da composição inteira ligadas ao mesmo vínculo lógico. Reserva e bloqueio perdedores responderam `409 SLOT_UNAVAILABLE`; recorrência perdedora gravou uma exceção `CONFLICT`, sem reserva parcial. Reprocessar o contrato não duplicou efeito. Histórico, chave idempotente, ausência de órfãos e sobreposições, disponibilidade indisponível e notificações WebSocket de sucesso apenas para o tipo vencedor foram verificados. A sentinela `NOTIFY` confirmou a drenagem observável do canal. Não há dados reais nem credenciais nos logs do teste.

**Classificação atualizada:** P1 de validação encerrado localmente. A validação remota no SHA do PR permanece condição do gate de publicação. A prova observa contenção no lock de venue e não exige que os três escritores atravessem ao mesmo tempo o lock exclusivo. O teste de múltiplas ocorrências válidas do contrato já reside em `booking.integration.test.ts`; a prova dedicada usa uma ocorrência por disputa para isolar o resultado.

## Limites e pendências

- Os pares recorrência/avulsa e composição/avulsa, a prova SQL direta com espera por lock e a falha SQL intermediária do gerador permanecem cobertos. O teste de trigger não prova retry automático do mesmo job falho.
- **P2 de ambiente:** o runner Windows apresentou um encerramento episódico do fork Vitest `0xC0000409` na suíte de acesso, já registrado historicamente em `PHASE1_RUNNER_A2_RESOLUTION.md`. A causa nativa permanece desconhecida; repetição serial passou 82/82 e as repetições padrão seguintes passaram 84/84, 85/85 e 86/86. CI remoto segue pendente.
- Proxy WebSocket no host definitivo, operação humana, latência de produção e CI remoto exigem validação fora do runner local. Decisões comerciais pendentes no ADR-014 não autorizam cobrança automática.

Não há P0 comprovado. O gate final depende das verificações restantes listadas em `PHASE4_GATE.md`.
