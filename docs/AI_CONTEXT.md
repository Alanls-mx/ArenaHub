# Contexto rápido

O ArenaHub é um SaaS multi-tenant. As Fases 1–4 estão integradas na `main`; a Fase 4 passou pelos gates locais, pela prova simultânea dos três escritores e pelo CI Linux do PR e do merge. A estrutura operacional da Fase 3 está no [ADR-012](decisions/ADR-012-phase3-operational-model.md). O motor de reservas, ocupações, mensalistas e WebSocket está mapeado em [PHASE4_ARCHITECTURE](PHASE4_ARCHITECTURE.md) e suas evidências e limites ficam em [PHASE4_GATE](PHASE4_GATE.md). Financeiro definitivo e ativação de domínios personalizados continuam planejados.

| Área                       | Local                          |
| -------------------------- | ------------------------------ |
| API                        | `apps/api`                     |
| Web                        | `apps/web`                     |
| Contratos                  | `packages/contracts`           |
| Especificação vigente      | `docs/ARENAHUB_MASTER_V3.2.md` |
| Histórico da especificação | `docs/ARENAHUB_MASTER_V3.1.md` |

**Venue** é um espaço reservável. **Unidade** é o recurso físico indivisível. **Ocupação** bloqueia uma unidade em um intervalo. **Contrato de mensalista** é estável; **recorrência** é uma versão das suas regras; **ocorrência** é uma reserva gerada. **Cobrança** é o valor devido; **alocação** associa parte de um pagamento a uma cobrança.
