# Padrões de engenharia

- Node.js 24 LTS, TypeScript strict, pnpm 11.25.0. Não usar `any` indiscriminado.
- `pnpm lint` executa ESLint; `pnpm typecheck` executa TypeScript; `pnpm format:check` executa Prettier.
- Fronteiras de imports impedem Prisma em Web/contratos e código interno da API na Web. Dados de domínio não são implementados em componentes Next.js.
- Migrations aditivas. SQL especializado fica em migration manual e passa por `db:check` semântico em PostgreSQL real.
- Cada operação tenant recebe contexto validado e filtro de organização no repository. SQL manual precisa de parâmetro de organização. `forTenant` não substitui revisão.
- Dinheiro é centavo inteiro; instantes são UTC e horários comerciais são locais. Use `shared/money` e `shared/time`.
- Jobs e mutações idempotentes devem suportar reexecução; não prometer execução exatamente uma vez.
- Testes de integração só são iniciados pelo runner Testcontainers; nunca usar o banco de desenvolvimento.
