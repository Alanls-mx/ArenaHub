# ArenaHub

SaaS multi-tenant de gestão de arenas esportivas. A especificação vigente é [docs/ARENAHUB_MASTER_V3.2.md](docs/ARENAHUB_MASTER_V3.2.md). Instruções para agentes estão em [AGENTS.md](AGENTS.md).

## Desenvolvimento

Requer Node.js, pnpm e Docker. Copie `.env.example` para `.env`, execute `docker compose up -d`, `pnpm install` e `pnpm dev`.

Web: http://localhost:3000 · API: http://localhost:3001/api/v1/health · Mailpit: http://localhost:8025.

O projeto está no início da Fase 1. A prova de ocupação com PostgreSQL e Prisma está em `apps/api/prisma`; veja [ADR-004](docs/decisions/ADR-004-occupancy-spike.md). Autenticação e reservas ainda não foram implementadas.

## Verificação

Com o PostgreSQL local ativo: `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm --filter @arenahub/api exec prisma migrate deploy`, `pnpm db:check` e `pnpm test:integration`.

