# Contexto rápido

O ArenaHub é um SaaS multi-tenant. A Fase 1 foi integrada e a Fase 2 implementou identidade, sessões, administração e registro de hosts por organização. A Fase 3 implementa clientes básicos, modalidades, venues e unidades físicas, horários, exceções, preços e simulação; veja [ADR-012](decisions/ADR-012-phase3-operational-model.md) e [gate](PHASE3_GATE.md). Agenda, mensalidades, financeiro e ativação de domínios personalizados continuam planejados.

| Área                       | Local                          |
| -------------------------- | ------------------------------ |
| API                        | `apps/api`                     |
| Web                        | `apps/web`                     |
| Contratos                  | `packages/contracts`           |
| Especificação vigente      | `docs/ARENAHUB_MASTER_V3.2.md` |
| Histórico da especificação | `docs/ARENAHUB_MASTER_V3.1.md` |

**Venue** é um espaço reservável. **Unidade** é o recurso físico indivisível. **Ocupação** bloqueia uma unidade em um intervalo. **Contrato de mensalista** é estável; **recorrência** é uma versão das suas regras; **ocorrência** é uma reserva gerada. **Cobrança** é o valor devido; **alocação** associa parte de um pagamento a uma cobrança.
