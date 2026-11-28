# ADR-002 — Isolamento entre arenas

Status: **provisório; revisão obrigatória após o spike de `forTenant` e antes do piloto**.

Toda tabela tenant usa `organization_id NOT NULL`, e relações entre entidades tenant usam FKs compostas. Repositories recebem `TenantContext` e aplicam filtro explícito. `forTenant(ctx)` ajuda a reduzir erros repetitivos, mas não é uma fronteira de segurança: SQL manual, views, agregações, operações aninhadas e transações exigem verificação própria.

A membership e as capacidades são revalidadas em cada requisição. Remover o usuário de uma arena invalida o acesso àquela arena sem revogar a sessão global ou suas outras memberships.

O spike deve exercitar `connect`, `upsert`, writes aninhados, transações, SQL manual, views e agregações. Se algum caminho não puder ser isolado com confiança por contrato, revisão e teste, a decisão de RLS será reaberta **antes do piloto**, com prova de funcionamento sob pool de conexões. Até lá, não se declara RLS implementada nem dispensada definitivamente.

## Evidência atual (26/11/2026)

O experimento com Prisma 7.10.1 demonstrou filtro auxiliar em `findUnique`, `findFirst`, `findMany`, `count` e `groupBy` de primeiro nível. Testes negativos demonstraram que `$queryRaw`, view global, `update` por ID e escrita aninhada podem acessar ou alterar outra organização mesmo no client estendido. A FK composta bloqueou vínculo cruzado na tabela de ocupação, mas não bloqueia uma operação coerente inteiramente na organização errada. O repository experimental filtrou listagem, contagem, mutações, upsert e SQL parametrizado. Portanto, **a extensão não é uma barreira de segurança**; um repository deve exigir `TenantContext` e inserir `organizationId` no predicado de toda operação. SQL manual, views e agregações precisam do mesmo filtro explícito. Escritas aninhadas e transações não são interceptadas automaticamente pela extensão de query do Prisma.

A matriz técnica do spike foi ampliada na Fase 1.1. O sistema de identidade e seus endpoints ainda não existem; esta matriz cobre somente as entidades experimentais e não substitui testes por endpoint na Fase 2.

## Matriz técnica do spike

| Operação                              | Controle necessário                                                                                         | Evidência em PostgreSQL descartável                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `findUnique`, `findFirst`, `findMany` | Extensão filtra chamada de primeiro nível; repository usa predicado ou chave composta                       | Busca de B sob contexto A vazia                                             |
| `count`, `aggregate`, `groupBy`       | Extensão auxilia; repository filtra explicitamente                                                          | Contagens/grupos somente de A                                               |
| `create`, `createMany`                | Repository cria `organizationId` a partir do contexto; client direto deve ser proibido na camada de produto | Linhas criadas sob A                                                        |
| `update`, `updateMany`                | Repository usa chave/`where` composto; client estendido não protege escrita                                 | Atualização de B por repository retorna ausência; `update` direto atravessa |
| `delete`, `deleteMany`                | Repository usa chave/`where` composto; client direto proibido                                               | Remoção de B recusada/zero, A removida                                      |
| `upsert`                              | Chave composta e `organizationId` no create; client direto requer contenção                                 | `upsert` do repository cria em A                                            |
| `connect`, `connectOrCreate`          | Chave composta no repository e FK composta; relação direta sem escopo proibida                              | B recusada; criação própria permitida                                       |
| Leitura aninhada                      | Somente via raiz escopada ou consulta filha com predicado explícito                                         | Ocupações do repository não incluem B                                       |
| Escrita aninhada                      | Proibir client estendido direto; API específica do repository verifica contexto                             | Escrita aninhada direta alterou B no teste negativo                         |
| Transação interativa e em lote        | Cada consulta conserva predicado; não assumir propagação automática                                         | Contagens A/B explícitas; rollback preservou organização                    |
| SQL manual e views                    | Parâmetro de organização obrigatório; view comum não filtra sozinha                                         | SQL/view sem filtro revelaram B; consultas escopadas não                    |
| Alteração de `organizationId`         | Proibir no repository; FK apenas impede algumas trocas                                                      | `update` direto pôde mover unidade sem filhos em transação revertida        |
| Contexto ausente/inválido/reutilizado | Rejeitar na construção do repository e da extensão; nunca usar fallback                                     | Contexto inválido falha; A não lê B após reutilização do client             |
| Reutilização de conexão               | Predicado por operação; contexto RLS só com `SET LOCAL`                                                     | Pool de tamanho 1 alternou tenants sem resíduo                              |

**Classificação:** somente as leituras de primeiro nível listadas têm ajuda automática da extensão. Repositories são a proteção primária do caminho autorizado; FK composta protege referências. Escritas diretas, nested writes genéricos e SQL sem tenant devem ser proibidos no código de produto. Operações administrativas globais e worker exigirão interfaces/papéis separados; não se aplica tratá-los como chamadas tenant comuns.

## Comparação com RLS isolado

O experimento `rls.integration.test.ts` criou papéis separados de migração, owner e aplicação em schema descartável. O papel da aplicação não é superusuário nem tem `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` faz também o owner obedecer às políticas. `USING` restringiu `SELECT`, `UPDATE` e `DELETE`; `WITH CHECK` recusou `INSERT` e troca de organização. Sem contexto ou com contexto inválido, nenhuma linha foi lida. `set_config(..., true)` dentro de transação limitou o contexto ao commit/rollback; pool com uma conexão reutilizada não vazou o tenant. Prisma em transação interativa, SQL manual, escrita aninhada e view `security_invoker` respeitaram as políticas.

| Alternativa                    | Resultado                                                                                   | Custo/limite                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A — repository + extensão + FK | Protege os caminhos autorizados demonstrados, mas client/SQL direto pode vazar ou alterar B | Revisão e testes de cada caminho são obrigatórios                                                  |
| B — A + RLS                    | Falha fechada para consultas sem contexto e bloqueia escrita aninhada fora do tenant        | Papéis separados, políticas por tabela, transação por operação tenant e testes de pool/view/worker |

RLS com GUC customizada **não autentica** o usuário: código com SQL arbitrário pode definir outro `organization_id`. A API deve derivar o contexto de membership revalidada e manter repositories e FKs. O superusuário de migração bypassa RLS; não deve ser usado pela aplicação. Workers globais precisam de papel e funções explicitamente autorizados, nunca de bypass implícito. O spike tem duas organizações e poucas linhas: não produz estimativa confiável de latência ou custo de planejamento. Antes de ativar RLS em produção, medir planos e volume representativos, com índices por `organization_id`.

**Recomendação:** preparar RLS como defesa adicional nas migrations tenant da Fase 2, sob papel de aplicação sem bypass e contexto transacional obrigatório, após o modelo de identidade existir. A adoção deve ser explícita e passar pela mesma matriz de regressão; o spike não introduz RLS no schema definitivo. Na data deste ADR, CI e validação comercial estavam pendentes. A situação atual da estratégia comercial foi alterada por [ADR-009](ADR-009-founder-led-development.md); entrevistas foram adiadas e não bloqueiam desenvolvimento.

## Condições de adoção na Fase 2

- Papel da aplicação: `NOSUPERUSER NOBYPASSRLS`, sem propriedade das tabelas. Papel de migrations/owner separado, com credencial inacessível à API e ao worker comum.
- Cada operação tenant deriva `organization_id` de membership revalidada e o define via `SET LOCAL` ou `set_config(..., true)` **dentro** da transação Prisma; política por tabela com `USING` e `WITH CHECK`, `FORCE ROW LEVEL SECURITY` e FKs compostas. Contexto ausente ou inválido falha fechado.
- Views de dados tenant usam `security_invoker` e passam pela matriz. Worker tenant usa o mesmo papel e transação contextual; jobs administrativos globais exigem interface e papel separados, autorização explícita e auditoria, sem `BYPASSRLS` implícito.
- SQL arbitrário ainda pode forjar a GUC; RLS não substitui autenticação, autorização ou revisão de repositories. Repetir testes por endpoint, Prisma nested writes, pooling, jobs, views e consultas manuais, além de benchmark com volume e índices representativos antes do piloto.

## Reprodução

Na raiz, executar `pnpm test:integration`. O runner cria PostgreSQL descartável, aplica as migrations do spike e roda `tenant.integration.test.ts` e `rls.integration.test.ts` junto com as demais verificações. O teste RLS cria e remove papéis e schema próprios nesse banco, sem aplicar política RLS ao schema de desenvolvimento ou produção.

## Aplicação na identidade — 27/11/2026

As rotas organizacionais de identidade derivam o tenant de sessão e membership ativa no escopo de uma transação. A implementação atual em arena_identity usa filtros explícitos e FKs compostas. A matriz HTTP e os testes em duas arenas sustentam essa escolha para a Fase 2 local. RLS segue como defesa adicional a avaliar antes do piloto com papéis de aplicação e worker e volume representativo. Evidências de endpoint e limites desta rodada estão no [gate da Fase 2](../PHASE2_GATE.md).

Na auditoria direcionada, o host ativo passou a vincular adicionalmente a requisição a uma arena. Host desconhecido, domínio pendente/suspenso e slug de outra arena retornam 404. Chamadas diretas não confiam em `X-Forwarded-Host`; apenas o proxy interno e peer IP configurados podem fornecer o host público. A suíte de integração cobre esses caminhos e SQL direto para o último Owner com papel sem superusuário. Para os endpoints atuais, filtros explícitos, membership revalidada, FKs e provas negativas são suficientes para o gate local. RLS não foi habilitada; reabrir a decisão antes do piloto ao introduzir novos repositories, jobs tenant ou consultas SQL sem escopo comprovável, além de medir planos sob carga representativa.

## Revisão da Fase 3 — 27/11/2026

As novas rotas operacionais em `operations/routes.ts` usam a mesma sessão e host da identidade, revalidam membership/capability e passam `organization_id` como parâmetro em todas as leituras, escritas, subconsultas e relações. FKs compostas protegem links de unidades, modalidades, horários, exceções e preços; triggers diferidos protegem composição ativa. Testes negativos exercitam leitura de duas arenas, capability Staff, IDs alheios e FK cruzada. O cálculo de preço é puro e a consulta carrega apenas regras do venue/tenant. O novo domínio ainda não adiciona workers ou SQL global; portanto a adoção de RLS segue pendente de teste de papéis, pools e desempenho antes do piloto. Qualquer caminho futuro sem isolamento demonstrável reabre esta decisão antes de habilitá-lo.
