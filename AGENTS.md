# ArenaHub — instruções para agentes

Leia `docs/AI_CONTEXT.md` e a seção pertinente de `docs/ARENAHUB_MASTER_V3.1.md` antes de implementar uma tarefa. O documento mestre descreve o produto; decisões de implementação devem ser confirmadas por testes.

## Regras centrais

- Toda consulta de dados da arena é limitada por `organization_id`; relações tenant usam FKs compostas.
- Instantes são UTC; horários comerciais são locais da organização; conversões ficam em `apps/api/src/shared/time`.
- Dinheiro é inteiro em centavos.
- A agenda é protegida pela exclusion constraint do PostgreSQL.
- Reservas e registros financeiros são corrigidos por estados e eventos, sem apagamento.
- Erros da API seguem RFC 9457 e usam códigos estáveis em `packages/contracts`.
- Mutações de agenda e financeiro indicadas no documento exigem `Idempotency-Key`.
- Componentes da Web usam tokens de tema.

Ao concluir cada mudança, informe arquivos alterados, comportamento, migrations, testes e pendências.

