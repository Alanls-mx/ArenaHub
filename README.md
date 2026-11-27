# ArenaHub

SaaS multi-tenant de gestão de arenas esportivas. A especificação vigente é [docs/ARENAHUB_MASTER_V3.2.md](docs/ARENAHUB_MASTER_V3.2.md). Instruções para agentes estão em [AGENTS.md](AGENTS.md).

## Desenvolvimento

Requer Node.js 24, pnpm 11.25 e Docker. Copie `.env.example` para `.env`, execute `docker compose up -d postgres mailpit`, `pnpm install`, `pnpm --filter @arenahub/contracts build` e `pnpm dev`. O worker experimental inicia separadamente com `pnpm dev:worker`.

Web: http://localhost:3000 · API: http://localhost:3001/api/v1/health · Mailpit: http://localhost:8025.

A página inicial oferece acesso da equipe, seleção de organização, cargos e membros. Consulte o [gate da Fase 2](docs/PHASE2_GATE.md). Para provisionar uma organização local, aplique as migrations com `pnpm db:migrate` e execute `pnpm org:create` fornecendo JSON pela entrada padrão com slug, name, ownerName, email e password (mínimo 12 caracteres). Uma conta existente conserva sua senha. A API usa WEB_ORIGIN e SMTP_URL; desenvolvimento envia e-mail ao Mailpit em localhost:1025. O Next encaminha /api/v1 para API_INTERNAL_ORIGIN (padrão http://127.0.0.1:3001). Se o endereço interno mudar, ajuste PROXY_INTERNAL_HOST e TRUSTED_PROXY_IPS para que a API aceite o host público apenas do proxy confiável.

## Verificação

Execute `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e `pnpm build`. A integração cria seu próprio PostgreSQL descartável; não requer migrations no banco de desenvolvimento. `pnpm db:check` é opcional e verifica o schema experimental do banco local após `pnpm db:migrate`.
