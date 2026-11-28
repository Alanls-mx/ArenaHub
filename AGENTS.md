# ArenaHub — instruções para agentes

## Contexto e fontes

SaaS multi-tenant para gestão de arenas. Leia `docs/AI_CONTEXT.md` e a seção pertinente de `docs/ARENAHUB_MASTER_V3.2.md` antes de alterar comportamento. A especificação descreve o produto; o código e os testes mostram o estado implementado. Registre decisões novas em `docs/decisions/`.

As Fases 3 e 4 estão na `main`: estrutura operacional (ADR-012 e `docs/PHASE3_GATE.md`) e motor de reservas (`docs/PHASE4_ARCHITECTURE.md` e `docs/PHASE4_GATE.md`). `apps/api/prisma` também contém provas técnicas no schema PostgreSQL `occupancy_spike` (ocupação e idempotência); suas tabelas não são o modelo final de produção. `pg-boss` administra `arena_jobs`. Veja `docs/PHASE1_GATE.md` para o estado histórico da Fase 1.

## Estrutura e comandos existentes

- `apps/api`: Fastify, Prisma e testes de integração.
- `apps/web`: Next.js e tema da Web.
- `packages/contracts`: schemas e códigos de erro compartilhados.
- `pnpm dev`, `pnpm dev:worker`, `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm db:migrate`, `pnpm db:check`.
- Banco local: `docker compose up -d postgres`. Nunca use dados reais no banco local ou no CI.

## Isolamento entre arenas

- Toda tabela tenant tem `organization_id NOT NULL`; toda relação entre dados tenant usa FK composta.
- O `organization_id` vem do `TenantContext` resolvido no backend, nunca do corpo da requisição.
- `forTenant(ctx)` é uma ajuda para o programador, **não uma barreira de segurança**. Cada repository aplica filtro explícito; SQL manual, views e agregações exigem o tenant como parâmetro.
- Teste leitura e regressão, alteração e referência entre arenas em cada endpoint. Cubra também `connect`, `upsert`, operações aninhadas, transações, SQL manual, views e agregações. Respostas de recurso de outra arena são `404`; listas não incluem linhas da outra arena.
- Revalide membership e capacidades em cada requisição. Remover membership de uma arena não revoga a sessão global nem o acesso às outras arenas.
- Reavalie RLS no ADR-002 após o spike de isolamento e antes do piloto se algum caminho de acesso não ficar demonstravelmente seguro.

## Agenda, tempo e preços

- Instantes concretos usam `timestamptz`/UTC; horários comerciais são locais da organização. Conversões ficam em `apps/api/src/shared/time`.
- Toda ocupação é escrita pelo service de agendamento; a exclusion constraint PostgreSQL é a autoridade contra sobreposição.
- Mutações operacionais, reservas e bloqueios travam a organização antes do venue, antes de ler composição, horários, exceções globais e preços ou escrever ocupações. Ao travar dois venues, use ordem crescente de ID.
- Versões da recorrência do mesmo contrato não podem sobrepor datas; a migration da Fase 4 impõe isso no banco.
- Regras de preço do mesmo venue são alteradas sob lock e revalidadas na transação para evitar corrida entre administradores.

## Financeiro

- Dinheiro é inteiro em centavos; não use float para cálculo de valor.
- Não apague reservas, cobranças, pagamentos ou alocações. Use estados, anulação, substituição e reversão.
- Uma cobrança substituta aponta `replaces_charge_id` para a anterior. Índices parciais permitem histórico de anuladas e no máximo uma cobrança ativa por vínculo lógico. O job mensal verifica também cobranças anuladas e não recria a competência automaticamente.
- Alocações usam `customer_id` e FKs triplas para garantir que pagamento e cobrança pertencem ao mesmo cliente. Trave pagamento e cobrança antes de verificar saldos.
- `payment_balances` agrega alocações e devoluções separadamente para evitar multiplicação de linhas.
- Funcionário só vê cobranças abertas do cliente atendido, não pendências globais. No-show segue a versão da política central da plataforma. As condições financeiras aguardam definição.

## API, autenticação e Web

- Erros da API usam Problem Details (RFC 9457) com `code` de `packages/contracts/src/errors.ts`.
- Mutações de agenda e financeiro marcadas na tabela da §8 do documento exigem `Idempotency-Key`.
- O host de produção é dedicado ao ArenaHub; `/api/v1` passa pelo mesmo host da Web via proxy. Cookie `__Host-session` não usa atributo `Domain`; métodos mutáveis exigem CSRF vinculado à sessão.
- Não coloque regra de negócio em Server Actions ou Route Handlers do Next.js. Componentes usam tokens do tema.
- Convites têm token de uso único com hash, expiração, revogação e aceitação transacional.

## Fluxo de mudança

1. Antes de mudar o código, construa um mapa do sistema relevante e rastreie o fluxo completo afetado: entrada e interface/API, contratos e validação, serviços e regras, persistência/migrations, eventos e jobs, configurações, dependências e consumidores. Identifique fronteiras entre pacotes, integrações internas/externas, ciclo de vida e pontos de falha. Consulte código, testes e documentação; não deduza integração apenas pelo nome de um módulo.
2. Para funcionalidade nova, documente como ela funciona e se conecta ao sistema existente: componentes e responsabilidades, sequência dos dados, contratos, efeitos colaterais, permissões/tenant, comportamento em falhas e estratégia de recuperação. Verifique efeitos nos consumidores e fluxos existentes antes de implementar.
3. Depois da mudança, atualize o mapa para refletir o sistema real e confirme cada ligação nos arquivos e testes correspondentes. Registre no resumo a funcionalidade, o fluxo ponta a ponta, as integrações tocadas, as fronteiras que permanecem fora do escopo e as evidências de verificação. Mantenha documentação arquitetural concisa e junto da documentação existente; crie ou atualize ADR quando houver decisão arquitetural.
4. Leia as fontes e seções pertinentes para completar esse mapa. Atualize contrato, migration, service, rota e tela conforme o caso.
5. Migrations são aditivas por padrão. Mantenha SQL manual para `tstzrange`, exclusion constraints, índices parciais, CHECKs e views; execute `pnpm db:check` após alterá-las.
6. Teste comportamento e concorrência com PostgreSQL real quando a mudança envolver agenda, isolamento ou dinheiro. Execute `pnpm typecheck`, `pnpm build` e os testes afetados.
7. Atualize documentação quando comportamento, contrato ou decisão mudar. Não declare uma fase concluída antes de passar pelo gate correspondente.

Ao concluir, informe arquivos alterados, comportamento, migrations, testes, pendências e riscos conhecidos.
