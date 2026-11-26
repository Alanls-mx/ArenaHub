# Contexto rápido

O ArenaHub é um SaaS multi-tenant para gestão de arenas esportivas. O MVP web cobre estrutura física, agenda, mensalistas, clientes e recebimentos. API Fastify e Web Next.js compartilham contratos Zod; PostgreSQL é a fonte da verdade. O projeto está no início da Fase 1: o spike de ocupação foi validado, mas o modelo de domínio ainda não existe.

| Área | Local |
| --- | --- |
| API | `apps/api` |
| Web | `apps/web` |
| Contratos | `packages/contracts` |
| Especificação | `docs/ARENAHUB_MASTER_V3.1.md` |

**Venue** é um espaço reservável. **Unidade** é o recurso físico indivisível. **Ocupação** bloqueia uma unidade em um intervalo. **Contrato de mensalista** é estável; **recorrência** é uma versão das suas regras; **ocorrência** é uma reserva gerada. **Cobrança** é o valor devido; **alocação** associa parte de um pagamento a uma cobrança.

