# Fase 2 — Identidade e acesso

A missão autorizou as etapas 2A a 2G. O [ADR-010](decisions/ADR-010-product-and-access.md) estabelece as decisões e a [matriz HTTP](PHASE2_ACCESS.md) descreve as rotas. O [gate](PHASE2_GATE.md) registra a validação local.

| Etapa | Entrega                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 2A    | Consolidar decisões, distinguir modelo executável de agenda e financeiro futuros                                       |
| 2B    | Migration incremental, identidades globais, criação controlada de organização e múltiplos Owners                       |
| 2C    | Login, recuperação por e-mail, senha, sessões revogáveis e CSRF                                                        |
| 2D    | Cargos por organização, união de capacidades, verificação nos services e limites de delegação                          |
| 2E    | Convites sem privilégio inicial, memberships, suspensão, revogação, administração de propriedade com senha e auditoria |
| 2F    | Login e painel responsivo, seletor de organização, sessões, membros e editor de cargos                                 |
| 2G    | PostgreSQL descartável, concorrência sobre propriedade, isolamento HTTP, validação visual e gates                      |
| 2H    | Fundação de domínios por organização: hostname único, estados, resolução segura do host e contrato de proxy            |

A próxima solicitação lê novamente membership e capabilities. Permissões financeiras são independentes no catálogo. A Fase 5 entregará os endpoints e as telas de pagamento.
