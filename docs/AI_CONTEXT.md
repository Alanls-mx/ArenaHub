# Contexto rápido

O ArenaHub é um SaaS multi-tenant. A Fase 1 foi integrada e a Fase 2 implementa identidade, sessões, administração e registro de hosts por organização. [ADR-010](decisions/ADR-010-product-and-access.md), [ADR-011](decisions/ADR-011-organization-domains.md) e [gate local](PHASE2_GATE.md) orientam a continuidade. Agenda, mensalidades, financeiro e ativação de domínios personalizados estão planejados.

| Área                       | Local                          |
| -------------------------- | ------------------------------ |
| API                        | `apps/api`                     |
| Web                        | `apps/web`                     |
| Contratos                  | `packages/contracts`           |
| Especificação vigente      | `docs/ARENAHUB_MASTER_V3.2.md` |
| Histórico da especificação | `docs/ARENAHUB_MASTER_V3.1.md` |

**Venue** é um espaço reservável. **Unidade** é o recurso físico indivisível. **Ocupação** bloqueia uma unidade em um intervalo. **Contrato de mensalista** é estável; **recorrência** é uma versão das suas regras; **ocorrência** é uma reserva gerada. **Cobrança** é o valor devido; **alocação** associa parte de um pagamento a uma cobrança.
