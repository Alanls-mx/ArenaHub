# Contexto rápido

O ArenaHub é um SaaS multi-tenant. A Fase 1 foi integrada e a Fase 2 implementa identidade, sessões e administração com dados reais. [ADR-010](decisions/ADR-010-product-and-access.md) e [gate local](PHASE2_GATE.md) orientam a continuidade. Agenda, mensalidades e financeiro estão planejados.

| Área                       | Local                          |
| -------------------------- | ------------------------------ |
| API                        | `apps/api`                     |
| Web                        | `apps/web`                     |
| Contratos                  | `packages/contracts`           |
| Especificação vigente      | `docs/ARENAHUB_MASTER_V3.2.md` |
| Histórico da especificação | `docs/ARENAHUB_MASTER_V3.1.md` |

**Venue** é um espaço reservável. **Unidade** é o recurso físico indivisível. **Ocupação** bloqueia uma unidade em um intervalo. **Contrato de mensalista** é estável; **recorrência** é uma versão das suas regras; **ocorrência** é uma reserva gerada. **Cobrança** é o valor devido; **alocação** associa parte de um pagamento a uma cobrança.
