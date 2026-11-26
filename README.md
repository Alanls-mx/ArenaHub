# ArenaHub

SaaS multi-tenant de gestão de arenas esportivas. A especificação vigente é [docs/ARENAHUB_MASTER_V3.2.md](docs/ARENAHUB_MASTER_V3.2.md). Instruções para agentes estão em [AGENTS.md](AGENTS.md).

## Desenvolvimento

Requer Node.js 24, pnpm 11.25 e Docker. Copie `.env.example` para `.env`, execute `docker compose up -d postgres mailpit`, `pnpm install` e `pnpm dev`. O worker experimental inicia separadamente com `pnpm dev:worker`.

Web: http://localhost:3000 · API: http://localhost:3001/api/v1/health · Mailpit: http://localhost:8025.

O projeto está na Fase 1. As provas de ocupação, isolamento, idempotência e jobs usam schemas experimentais; veja [gate](docs/PHASE1_GATE.md). Autenticação, reservas e financeiro comerciais ainda não foram implementados. As telas `/theme-preview` e `/agenda-preview` são demonstrativas.

## Verificação

Execute `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e `pnpm build`. A integração cria seu próprio PostgreSQL descartável; não requer migrations no banco de desenvolvimento. `pnpm db:check` é opcional e verifica o schema experimental do banco local após `pnpm db:migrate`.
