# ArenaHub — Documento Mestre v3.2 e Plano de Implementação

Nov 26, 2026 · @Alan

## 1. Visão executiva e escopo

O ArenaHub é um SaaS multi-tenant de gestão de arenas esportivas. A primeira entrega é um **MVP Web** que organiza agenda, mensalistas, clientes e recebimentos de uma arena, validado em piloto real antes de qualquer app nativo ou módulo adicional.

Diretriz central: engenharia sólida onde erros são caros (agenda, isolamento entre arenas, financeiro, segurança, persistência) e simplicidade deliberada em todo o resto.

### 1.1. Escopo do MVP (piloto)

| Área | Incluído no MVP |
| --- | --- |
| Identidade | Login da equipe, sessões revogáveis, ownership múltiplo e cargos personalizados, matriz de permissões no backend |
| Estrutura | Espaços (venues), unidades físicas, espaços divisíveis, modalidades, horários de funcionamento (inclusive após meia-noite), preços, bloqueios |
| Agenda | Visão diária e semanal, reservas avulsas, edição, remarcação, cancelamento, recorrências (mensalistas), exceções, histórico |
| Clientes | Cadastro, telefone E.164, observações, histórico, situação financeira |
| Financeiro | Cobranças, pagamentos manuais, pagamentos parciais, alocações, anulação, estorno, crédito do cliente, pendências |
| Comunicação | Botões `wa.me` com mensagens prontas (confirmação, lembrete, cobrança) |
| Painel | Dashboard com 4 indicadores fixos, layout responsivo |

**Identidade visual** também entra no MVP: cada arena recebe um tema próprio (logo, cores, fontes) aplicado sobre um design system único, com o design da LumixEngine como tema padrão (§9).

### 1.2. Fora do MVP

App mobile, página pública de reservas, holds, outbox, SSE/WebSocket, push, Redis, API oficial do WhatsApp, gateways adicionais, módulos Bar / Media / Events / Business, relatórios avançados, microserviços. RLS é uma decisão de segurança reavaliada antes do piloto (§4.1), não uma funcionalidade comercial.

Cada item fora do MVP só entra com um consumidor real ou demanda comprovada no piloto.

### 1.3. O que mudou da v2.0 para a v3.0

| Tema | v2.0 | v3.0 |
| --- | --- | --- |
| Fuso horário | Implícito | Fuso IANA por organização; horários comerciais em hora local (§3.1) |
| Idempotência | Só em workers | `Idempotency-Key` obrigatório em criação de reserva, pagamento e cobrança (§3.3) |
| Contratos REST | Não padronizados | Erro RFC 9457 com `code` estável, paginação por cursor (§3.4) |
| Mobile nas fases iniciais | Expo na Fase 0, auth mobile na Fase 2, pastas criadas | Tudo movido para a Fase 8; Fase 2 só garante sessões aptas a cookie e bearer |
| Holds | No modelo do MVP | Adiados junto com a página pública |
| Outbox | No MVP | Adiado até o primeiro consumidor; agenda usa refetch (§9) |
| Telefone | Índice único ambíguo | Índice não único + aviso de duplicidade |
| `PENDING` | Origem indefinida | "Aguardando confirmação do cliente"; ocupa a agenda |
| Múltiplas unidades | Implícito | Regras explícitas de criação, remarcação e validação (§6.2) |
| Cobranças | Estado 100% derivado | `voided_at`, `reversed_at`, crédito como saldo não alocado (§7) |
| Preço de mensalista | Não coberto | Nível 0 de precedência: preço acordado da recorrência (§6.6) |
| Cobrança mensal | Sem job | Política configurável e job de geração (§7.5) |
| Nova versão de recorrência | Implícito | Cancelar e regenerar ocorrências futuras na mesma transação (§6.5) |
| Permissões | Só papéis | Matriz de capacidades (§4.4) |
| Exclusão | Indefinida | Arquivamento + anonimização LGPD (§3.6) |
| Sessões | Token | Hash SHA-256 do token no banco (§4.2) |
| Roadmap | Sem estimativas | Estimativas por fase e marco de piloto (§11) |
| Itens da v1 perdidos | — | Comandos, lições aprendidas e regras de contrato recuperados |

### 1.4. Correções da v3.1

- Dependências entre clientes, ocupações, bloqueios e financeiro foram alinhadas às fases (§11).
- Mensalistas agora têm um contrato estável entre versões; a cobrança mensal é única por contrato e mês (§5–7).
- Idempotência concorrente, permissões financeiras, devoluções parciais e alterações das unidades físicas ganharam regras explícitas.
- Horários ambíguos, turnos de funcionamento, precificação por trechos e cobrança de meses parciais ganharam exemplos e testes.

### 1.5. Correções da v3.2

- `forTenant(ctx)` passa a ser apoio de ergonomia, com testes explícitos de todas as operações que podem contorná-lo; RLS será reavaliada antes do piloto.
- Membership é revalidada a cada requisição, e a sessão global continua válida nas outras arenas; Web e API usam o mesmo host dedicado.
- Funcionário não vê pendências globais nem decide taxa de no-show.
- Substituição de cobrança, cliente das alocações, unicidade de exceções, versões de recorrência e concorrência de preços e unidades recebem garantias definidas.
- Convites, configurações de comunicação e `payment_balances` passam a ter contratos de dados e tarefas próprias.

### 1.6. Estratégia de desenvolvimento — decisão do fundador (27/11/2026)

- O desenvolvimento seguirá inicialmente a visão do fundador, as funcionalidades planejadas e as regras documentadas. Entrevistas comerciais foram adiadas até que exista uma solução funcional e madura para demonstração; não são gate de entrada da Fase 2.
- Nenhuma pesquisa ou evidência de cliente é presumida. Regras operacionais e financeiras sem validação permanecem hipóteses de produto; novas evidências poderão motivar evolução e migrations aditivas.
- A Fase 1 está **concluída — fundação técnica aprovada**. O gate técnico não aprova automaticamente todas as regras comerciais nem o modelo definitivo de produção.
- `docs/DATABASE.md` e `docs/ERD.md` são candidatos de modelagem para aprovação explícita do fundador. Não criar migrations definitivas de domínio antes dessa aprovação.
- O registro completo, riscos assumidos e efeitos no roadmap estão em [ADR-009](decisions/ADR-009-founder-led-development.md); a [Fase 2](PHASE2_PROPOSAL.md) foi autorizada na missão seguinte.

### 1.7. Decisões aprovadas para implementação

A [matriz oficial das doze decisões](decisions/ADR-010-product-and-access.md) rege as fases 2–6. O [ADR-011](decisions/ADR-011-organization-domains.md) define a fundação de domínios por organização. A [matriz HTTP implementada](PHASE2_ACCESS.md) especifica os controles da identidade. As matrizes de papéis dos fluxos futuros descrevem templates iniciais ajustáveis.

## 2. Arquitetura, stack e monorepo

O ArenaHub é um monólito modular: uma API Fastify com módulos de limites claros, um processo worker do mesmo código e um PostgreSQL como única fonte da verdade. Web e Mobile só falam com a API.

&#91;embedded content: arquitetura do MVP · tracejado = fases futuras\]

No MVP existem três processos: web, api e worker. O app Android entra na Fase 8 consumindo a mesma API com token bearer.

### 2.1. Stack

| Camada | Tecnologia | Observação |
| --- | --- | --- |
| Web | Next.js, React, TypeScript, Tailwind CSS | Só consome a API; sem regra de negócio em Server Actions ou Route Handlers |
| API | Node.js LTS, Fastify, TypeScript strict | `fastify-type-provider-zod` para validar e gerar OpenAPI |
| Banco | PostgreSQL 16+, Prisma | SQL manual nas migrations para `tstzrange`, exclusion constraints e CHECKs |
| Jobs | Fila em PostgreSQL (pg-boss ou graphile-worker, decidido na Fase 1) | Mesmo código da API, processo separado |
| Contratos | Zod em `packages/contracts` | Tipos inferidos; compartilhado por Web, API e Mobile |
| Datas | Temporal polyfill ou date-fns-tz | Conversões local ↔ UTC só em uma biblioteca de domínio de tempo |
| Logs | Pino | JSON estruturado, `request_id`, `organization_id` |
| Erros | Sentry (ou equivalente) | Web e API |
| Testes | Vitest, Testcontainers (PostgreSQL), Playwright | Maestro na Fase 8 |
| Mobile (Fase 8) | React Native, Expo Development Builds, SecureStore | Android primeiro |

### 2.2. Módulos da API

| Módulo | Responsabilidade | Fase |
| --- | --- | --- |
| `identity` | Usuários, senhas, sessões, recuperação de senha | 2 |
| `organizations` | Organizações, memberships, papéis, configurações, fuso | 2 |
| `venues` | Venues, unidades, links, modalidades, horários e preços | 3 |
| `scheduling` | Ocupações, disponibilidade, reservas, recorrências, exceções | 4 |
| `customers` | Cadastro básico na Fase 3; notas, deduplicação e ficha na Fase 5 | 3/5 |
| `billing` | Cobranças, pagamentos, alocações, pendências | 5 |
| `audit` | `audit_logs` | 2 |
| `jobs` | Registro e execução de tarefas agendadas | 1 |

Um módulo só acessa as tabelas de outro módulo pelo service público dele. Exemplo: `billing` cria cobrança de reserva chamando uma função exposta, nunca lendo `reservations` direto com regras próprias. Transações que cruzam módulos recebem o cliente de transação como parâmetro.

### 2.3. Estrutura de um módulo

```text
apps/api/src/modules/scheduling/
├── scheduling.routes.ts      # rotas Fastify + schemas do contracts
├── reservations.service.ts   # regras de negócio e transações
├── reservations.repo.ts      # acesso a dados, sempre com orgId
├── occupancy.ts              # criação/desativação de ocupações
├── availability.ts           # cálculo de horários livres
├── recurrence.generator.ts   # materialização de ocorrências
├── errors.ts                 # erros de domínio do módulo
└── __tests__/
```

Limite prático: arquivo acima de \~400 linhas é sinal para dividir.

### 2.4. Monorepo do MVP

```text
arenahub/
├── apps/
│   ├── api/
│   │   ├── prisma/            # schema.prisma, migrations, seed.ts
│   │   └── src/
│   │       ├── modules/
│   │       ├── infrastructure/ # db, logger, jobs, email, config
│   │       ├── shared/         # auth, tenant context, errors, time, money
│   │       ├── server.ts
│   │       └── worker.ts
│   └── web/
│       └── src/
│           ├── app/
│           ├── features/
│           ├── components/
│           └── lib/            # api client, auth, formatters
├── packages/
│   └── contracts/
├── docs/
├── infrastructure/docker/
├── .github/workflows/
├── AGENTS.md
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

`apps/mobile` é criado só na Fase 8. O Prisma fica dentro de `apps/api`, e seus tipos não saem de lá.

### 2.5. Comandos padronizados

| Comando | Função |
| --- | --- |
| `pnpm dev` | Sobe api, worker e web em modo desenvolvimento |
| `pnpm build` | Build de todos os apps |
| `pnpm lint` / `pnpm typecheck` | Qualidade estática |
| `pnpm test` | Testes unitários |
| `pnpm test:integration` | Testes com PostgreSQL real (Testcontainers) |
| `pnpm test:e2e` | Playwright |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Banco local |
| `pnpm db:check` | Verifica drift entre schema e migrations |

## 3. Regras transversais

Estas regras valem para todos os módulos e entram no `AGENTS.md` e no `ENGINEERING_STANDARDS.md`. Violá-las é motivo para reprovar uma tarefa, mesmo com testes passando.

### 3.1. Tempo e fuso horário

- `organizations.timezone` guarda um fuso IANA (padrão `America/Sao_Paulo`). Obrigatório.
- **Instantes concretos** (início de reserva, pagamento, criação) são `timestamptz`, mapeados no Prisma com `@db.Timestamptz(3)`. Sempre UTC no banco e na API (ISO 8601 com `Z`).
- **Horários recorrentes** (funcionamento, recorrência, faixa de preço) são guardados como `weekday` (0–6) + `time` local (`@db.Time`), nunca como instante.
- **Datas de calendário** (vencimento, feriado, `effective_from`) são `date` local da organização.
- A conversão local → UTC acontece em um único lugar: `apps/api/src/shared/time/`. Nenhum outro arquivo faz aritmética de fuso.
- **Dia operacional:** um horário que fecha após meia-noite pertence ao dia em que abriu. `close_time < open_time` significa "fecha no dia seguinte"; horários iguais só são aceitos com `spans_full_day = true`.
- `open_time = close_time` é inválido; funcionamento contínuo é representado por `open_time = 00:00` e `close_time = 00:00` com `spans_full_day = true`. Dois turnos no mesmo dia são duas linhas, sem sobreposição, ordenadas por abertura.
- Hora local inexistente em mudança de fuso é recusada com `INVALID_LOCAL_TIME`. Hora ambígua exige `offset` explícito na entrada; sem ele, a API responde `AMBIGUOUS_LOCAL_TIME`. A recorrência preserva a hora local e, em dia ambíguo, usa o primeiro instante por padrão, registrando essa escolha no histórico.
- A API recebe e devolve instantes concretos em UTC; formulários de reserva e recorrência enviam data e hora locais da organização, com `offset` quando necessário, para conversão exclusiva em `shared/time`. A Web formata no fuso da organização (não no fuso do navegador).

### 3.2. Dinheiro

- Inteiro em centavos (`integer`, `amount_cents`). Nunca float, `Decimal` ou string.
- Moeda fixa BRL no MVP; coluna `currency` só se houver segunda moeda.
- CHECK `amount_cents >= 0` em valores que não podem ser negativos; estornos usam campos próprios, não valores negativos.
- Formatação só na interface (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).

### 3.3. Idempotência

- Header `Idempotency-Key` (UUID gerado no cliente) **obrigatório** nas mutações de agenda e financeiro marcadas `Sim` na §8, inclusive versões de recorrência, alocações, anulação, cancelamento e estorno. A tabela de rotas é a lista normativa.
- Tabela `idempotency_keys`: `(organization_id, user_id, key)` único, `method`, `route`, `request_hash`, `response_status`, `response_body`, `created_at`, `expires_at`. O hash inclui método, rota canônica, parâmetros de caminho e corpo normalizado. Expira em 24 h (job de limpeza).
- Mesma chave + mesmo corpo → devolve a resposta gravada. Mesma chave + corpo diferente → `409 IDEMPOTENCY_KEY_REUSED`.
- A primeira requisição reserva a chave por inserção única **na mesma transação** da operação. Uma segunda requisição simultânea espera o desfecho da primeira por até 5 s; após commit, recebe a resposta gravada; após rollback, pode executar; se continuar em andamento, recebe `409 IDEMPOTENCY_IN_PROGRESS` com `Retry-After: 1`. Nenhum efeito de domínio ocorre antes de adquirir a chave.
- O mesmo usuário não pode reutilizar a chave em outra rota, mesmo com corpo igual. A expiração limita a garantia de replay; o cliente não faz retentativa automática depois de 24 h sem consultar o recurso.
- A Web gera a chave ao abrir o formulário, não ao clicar, para que duplo clique e retentativa usem a mesma chave.

### 3.4. Contratos REST

- Prefixo `/api/v1`. Recursos da organização ficam em `/api/v1/orgs/:orgSlug/...` (a API valida a membership; ver §4.3).
- **Erros** no formato Problem Details (RFC 9457), com `code` estável:

```json
{
  "type": "https://arenahub.app/errors/slot-unavailable",
  "title": "Horário indisponível",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "A unidade já está ocupada nesse intervalo.",
  "requestId": "req_01J...",
  "errors": []
}
```

- Catálogo de códigos em `packages/contracts/src/errors.ts`. Exemplos: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `SLOT_UNAVAILABLE`, `OUTSIDE_OPERATING_HOURS`, `INVALID_TRANSITION`, `ALLOCATION_EXCEEDS_BALANCE`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED`.
- **Paginação** por cursor em listagens: `?limit=50&cursor=...` → `{ items, nextCursor }`. Limite máximo 100.
- **Concorrência otimista** em edições: campo `version` (inteiro) enviado no `PATCH`; divergência → `409 STALE_VERSION`.
- Respostas só com campos declarados no contrato (serialização pelo schema Zod, nunca o objeto do Prisma).

### 3.5. Histórico e auditoria

- `reservation_history`: linha do tempo de negócio visível na interface (criada, remarcada, confirmada, cancelada, no-show).
- `audit_logs`: quem fez o quê em segurança e administração (login, papéis, configurações, anulação de cobrança, estorno, exportação, exclusão LGPD).
- Eventos financeiros comuns (pagamento registrado) ficam nas próprias tabelas financeiras, que já são imutáveis; não são duplicados no histórico da reserva.

### 3.6. Exclusão e arquivamento

| Entidade | Política |
| --- | --- |
| Reservas, cobranças, pagamentos, alocações | Nunca apagadas. Cancelamento, anulação e estorno são estados |
| Clientes | Arquivados (`archived_at`). Exclusão LGPD = anonimização dos dados pessoais, mantendo registros financeiros |
| Venues, unidades, modalidades, regras de preço | Arquivados; não podem ser removidos se houver reserva vinculada |
| Notas de cliente | Podem ser apagadas pelo autor ou Proprietário (com audit log) |
| Sessões, chaves de idempotência, jobs concluídos | Removidos por rotina de limpeza |

### 3.7. Identificadores

- UUID v7 gerado na aplicação (biblioteca `uuid` v10+), coluna `uuid` no PostgreSQL. Ordenável por tempo e bom para índices.
- Slugs legíveis só para organização (`orgSlug`) e, no futuro, página pública.

### 3.8. Lições de projetos anteriores

- Não deixar tempo real "para depois" quando ele afeta a integridade da agenda; no MVP a integridade vem do banco e a atualização é por refetch.
- Não concentrar funcionalidades em arquivos gigantes; separar por módulo e por responsabilidade.
- Não começar com persistência improvisada (JSON, SQLite) para migrar depois; PostgreSQL desde o primeiro commit.
- Não negligenciar performance: `select` explícito, sem N+1, paginação, índices orientados a consultas reais, `EXPLAIN ANALYZE` nas consultas de agenda.

## 4. Multi-tenancy, autenticação e permissões

Toda requisição autenticada resolve um `TenantContext` (usuário, organização, papel, capacidades) antes de chegar ao service. Repositories não aceitam consultas sem `organizationId`.

### 4.1. Isolamento

- Toda tabela de dados da arena tem `organization_id NOT NULL`.
- Relações entre entidades da arena usam **FK composta** `(organization_id, id)`. Exemplo: `reservations (organization_id, customer_id) REFERENCES customers (organization_id, id)`. Isso torna impossível, no banco, ligar uma reserva da Arena A a um cliente da Arena B.
- Para isso, cada tabela tenant tem `UNIQUE (organization_id, id)` além da PK.
- `forTenant(ctx)` ajuda a aplicar `organization_id`, mas **não é fronteira de segurança por si só**. Repositories exigem `TenantContext` e filtro explícito; SQL manual, views e agregações também recebem `organization_id` como parâmetro obrigatório. Código de infraestrutura sem contexto passa por revisão específica.
- Testes de isolamento cobrem CRUD, operações aninhadas, `connect`, `upsert`, transações, SQL manual, views e agregações. A suíte verifica leitura, escrita e referência entre arenas; FKs compostas protegem referências, mas não substituem filtros de leitura.
- Após o spike de `forTenant` na Fase 1 e novamente antes do piloto, o ADR-002 registra os caminhos que a extensão não cobre. Se houver caminho difícil de garantir por revisão e testes, avaliar RLS antes do piloto, incluindo identidade do tenant na conexão, comportamento em pool e testes de bypass. RLS não é obrigatória por antecipação.
- Teste obrigatório por endpoint: usuário da Arena A tentando ler, alterar e referenciar recurso da Arena B recebe `404` (não `403`, para não revelar existência).

### 4.2. Sessões

| Aspecto | Web | Mobile (Fase 8) |
| --- | --- | --- |
| Transporte | Cookie `__Host-session`, HttpOnly, Secure, SameSite=Lax | `Authorization: Bearer <token>` |
| Armazenamento no cliente | Navegador | Expo SecureStore |
| CSRF | Header `X-CSRF-Token` (double submit) em métodos não GET | Não se aplica |
| Tabela | `sessions` (mesma) | `sessions` (mesma) |

- Token: 32 bytes aleatórios em base64url. O banco guarda só `token_hash` (SHA-256).
- Expiração deslizante de 30 dias, absoluta de 90 dias. `last_seen_at` atualizado no máximo a cada 5 min.
- Revogação da sessão global: logout, troca de senha (revoga as outras sessões), desativação do usuário ou ação de segurança do próprio usuário. Remover ou desativar uma membership **não revoga** as sessões globais: invalida imediatamente o acesso àquela organização; memberships de outras arenas continuam válidas.
- Senhas com Argon2id (parâmetros OWASP atuais). Rate limit de login: 5 tentativas / 15 min por e-mail + IP.
- Recuperação de senha por e-mail com token de uso único, validade de 30 min, hash no banco.
- **Domínios (ADR-005):** Web e API usam um host dedicado ao produto: `app.arenahub.com.br`, com a API em `app.arenahub.com.br/api/v1/...` por proxy reverso para o processo Fastify. O domínio definitivo pode mudar por decisão comercial, preservando a topologia de mesmo host. A instalação do Cine Cruzeiro fica em domínio e infraestrutura separados.
- Cookie `__Host-session` com `Path=/`, sem atributo `Domain`; o proxy encaminha `Cookie` e `Set-Cookie` sem expor a API em outro host público. Métodos mutáveis exigem token CSRF vinculado à sessão e validação de `Origin`/`Referer` quando presente. CORS não é necessário no fluxo Web de produção.

### 4.3. Organização ativa

- A rota carrega o `orgSlug`. A API busca a membership ativa do usuário naquela organização **a cada requisição**, inclusive após retentativa e em rotas de leitura; não confia em papel/capacidades guardados na sessão ou num cache com validade após revogação.
- Sem membership ativa → `404`. Membership sem a capacidade exigida → `403 FORBIDDEN`.
- O `organization_id` nunca vem do corpo da requisição.

### 4.4. Matriz de capacidades

Cargos são definidos pela organização, com união das capacidades do catálogo controlado pelo backend. Ownership é separado dos cargos.

| Capacidade | Proprietário | Administrador | Funcionário |
| --- | --- | --- | --- |
| Ver agenda e reservas | Sim | Sim | Sim |
| Criar e remarcar reserva avulsa | Sim | Sim | Sim |
| Cancelar reserva | Sim | Sim | Só se criada no mesmo dia por ele, até o início |
| Marcar no-show conforme política fixa | Sim | Sim | Sim |
| Aplicar, alterar ou dispensar taxa de no-show | Sim | Sim | Não |
| Criar, alterar e encerrar recorrência | Sim | Sim | Não |
| Criar e bloquear horários (manutenção) | Sim | Sim | Não |
| Cadastrar e editar clientes | Sim | Sim | Sim |
| Arquivar e anonimizar cliente | Sim | Não | Não |
| Registrar pagamento | Sim | Sim | Sim |
| Estornar pagamento | Sim | Sim | Não |
| Criar cobrança avulsa | Sim | Sim | Não |
| Anular cobrança | Sim | Sim | Não |
| Ver dashboard e relatórios financeiros | Sim | Sim | Não |
| Configurar venues, unidades, horários e preços | Sim | Sim | Não |
| Gerenciar membros e cargos | Sim | Conforme capacidades do cargo | Não por padrão |
| Configurações da organização e políticas | Sim | Não | Não |

A regra planejada permite ao Funcionário cancelar apenas reserva criada por ele no mesmo dia, antes do início; até aprovação do fundador, trate esse recorte como hipótese de produto. O dashboard do Funcionário omite valores financeiros agregados; ele só vê cobranças em aberto do cliente atendido ao registrar pagamento, sem acesso à listagem global de pendências, pagamentos ou relatórios. Ao marcar no-show, o backend aplica a política configurada; só Admin+ pode alterar ou dispensar a taxa, com motivo em audit log. Mudanças de capacidade são política de autorização e, em princípio, não exigem migration.

### 4.5. Cliente final (adiado)

O cliente final só ganha login com a página pública ou o app. A decisão entre link mágico por e-mail, OTP por SMS e OTP por WhatsApp fica para a Fase 9. Até lá, `customers.user_id` existe mas fica nulo.

### 4.6. Segurança geral

- Validação Zod de toda entrada no backend.
- Headers de segurança (`@fastify/helmet`). Em produção, Web e API são same-origin por proxy; CORS fica desabilitado. CORS restrito é usado apenas em desenvolvimento, se a Web local estiver em outra porta.
- Rate limit global por IP (`@fastify/rate-limit`) e específico em login e recuperação.
- Segredos só em variáveis de ambiente, validadas com Zod na inicialização.
- Logs nunca contêm senha, token, cookie, header `Authorization` ou corpo de login (redaction no Pino).

## 5. Modelo de dados do MVP

O modelo agrupa entidades por domínio, além de `organization_themes` e as tabelas da fila de jobs. `docs/DATABASE.md` e `docs/ERD.md` registram o modelo candidato para aprovação do fundador. Os tipos usam a prova técnica da Fase 1 e as premissas de produto explicitadas; feedback comercial posterior pode gerar evolução aditiva. Toda tabela tenant, inclusive tabelas de ligação e histórico, tem `organization_id NOT NULL`; tabelas com `id uuid PK` também têm `UNIQUE (organization_id, id)`. Relações tenant usam FKs compostas. Toda tabela tem `created_at` e, quando editável, `updated_at` e `version`.

### 5.1. Identidade e organização

| Tabela | Campos principais | Constraints e índices |
| --- | --- | --- |
| `users` | email (citext), password\_hash, name, phone\_e164, email\_verified\_at, disabled\_at | `UNIQUE (email)` |
| `sessions` | user\_id, token\_hash, client (`WEB`/`MOBILE`), expires\_at, absolute\_expires\_at, last\_seen\_at, revoked\_at, ip, user\_agent | `UNIQUE (token_hash)`, índice `(user_id)` |
| `password_reset_tokens` | user\_id, token\_hash, expires\_at, used\_at | `UNIQUE (token_hash)` |
| `organizations` | slug, name, timezone, status, políticas (ver abaixo) | `UNIQUE (slug)`, CHECK timezone não vazio |
| `memberships` | organization_id, user_id, is_owner, status | Chave composta por organização e usuário; cargos relacionados por membership_roles |
| `membership_invites` | email (citext), role, token\_hash, expires\_at, accepted\_at, revoked\_at, invited\_by | `UNIQUE (token_hash)`; no máximo um convite não aceito/não revogado por `(organization_id, email)` |
| `audit_logs` | organization\_id (nulo em eventos globais), actor\_user\_id, action, entity\_type, entity\_id, metadata jsonb, ip | índice `(organization_id, created_at DESC)` |
| `idempotency_keys` | organization\_id, user\_id, key, method, route, request\_hash, response\_status, response\_body jsonb, expires\_at | `UNIQUE (organization_id, user_id, key)` |

A organização define grade (padrão 15 min), duração (padrão 60 min), antecedência, dia de cobrança e modelos de comunicação. Cancelamento segue política versionada da plataforma vinculada à reserva.

Convite: Proprietário cria token aleatório de uso único, com hash no banco e validade de 7 dias. Reenviar revoga o convite anterior na mesma transação. Aceitar consome o token, verifica e-mail, cria usuário ou vincula o usuário existente e ativa a membership em uma transação. A busca usa o hash, nunca registra o token em logs; convite expirado ou revogado não concede acesso. A membership é revalidada em toda requisição (§4.3).

### 5.2. Estrutura da arena

| Tabela | Campos principais | Constraints e índices |
| --- | --- | --- |
| `sports` | name, archived\_at | `UNIQUE (organization_id, name)` |
| `venues` | name, slot\_minutes (nulo = padrão da org), min\_minutes, max\_minutes, buffer\_minutes, default\_price\_per\_hour\_cents, color, sort\_order, archived\_at | `UNIQUE (organization_id, name)` |
| `venue_units` | name, archived\_at | `UNIQUE (organization_id, name)` |
| `venue_unit_links` | venue\_id, unit\_id | PK `(venue_id, unit_id)`, FKs compostas |
| `venue_sports` | venue\_id, sport\_id | PK `(venue_id, sport_id)` |
| `operating_hours` | venue\_id, weekday (0–6), open\_time, close\_time, spans\_full\_day | Múltiplos turnos sem sobreposição por dia; igualdade só com `spans_full_day`; índice `(organization_id, venue_id, weekday)` |
| `calendar_exceptions` | venue\_id (nulo = arena toda), date, kind (`CLOSED`/`SPECIAL_HOURS`), open\_time, close\_time, description | `UNIQUE NULLS NOT DISTINCT (organization_id, venue_id, date)`; uma exceção global por data |
| `venue_blocks` | venue\_id, start\_at, end\_at, reason, created\_by, cancelled\_at, cancelled\_by | CHECK `end_at > start_at` |
| `pricing_rules` | venue\_id, sport\_id (nulo), specific\_date (nulo), weekday (nulo), start\_minute, end\_minute, price\_per\_hour\_cents, valid\_from, valid\_until, archived\_at | CHECK de combinação válida por nível; alterações serializadas pelo lock do venue, sobreposição validada na mesma transação |

O nível da regra é derivado das colunas preenchidas (ver §6.6). Arena simples: o sistema cria uma unidade por venue automaticamente e esconde o conceito na interface.

**Estado da Fase 3 em 27/11/2026:** as nove entidades desta fase foram implementadas em `arena_identity` pela migration `20261127014000_operational_structure`; `venue_blocks` pertence à Fase 4. Links de unidade/modalidade, horários, exceções e preços carregam `organization_id` nas FKs compostas. A composição ativa é protegida também por triggers diferidos. Faixas de preço usam minutos locais `[start_minute,end_minute)` no mesmo dia; um preço que cruza meia-noite exige duas regras. Veja [ADR-012](decisions/ADR-012-phase3-operational-model.md) e [gate da Fase 3](PHASE3_GATE.md) para evidência e limites.

### 5.3. Agenda

| Tabela | Campos principais | Constraints e índices |
| --- | --- | --- |
| `reservations` | venue\_id, sport\_id, customer\_id, recurrence\_id, occurrence\_date, start\_at, end\_at, status, source (`ADMIN`/`RECURRENCE`), price\_cents, price\_source (`RULE`/`DEFAULT`/`RECURRENCE`/`MANUAL`), pricing\_rule\_id, price\_breakdown jsonb, notes, created\_by, confirmed\_at, cancelled\_at, cancelled\_by, cancellation\_reason, no\_show\_at, version | CHECK `end_at > start_at`; `UNIQUE (recurrence_id, occurrence_date)`; índices `(organization_id, start_at)`, `(organization_id, customer_id, start_at DESC)` |
| `reservation_history` | reservation\_id, action, from\_status, to\_status, changes jsonb, actor\_user\_id | índice `(reservation_id, created_at)` |
| `recurrence_contracts` | customer\_id, billing\_mode (`MONTHLY`/`PER_OCCURRENCE`), status (`ACTIVE`/`ENDED`), ended\_at, ended\_by | Identidade estável do mensalista entre versões; índice `(organization_id, customer_id, status)` |
| `recurrences` | contract\_id, venue\_id, sport\_id, weekday, start\_time, duration\_minutes, starts\_on, ends\_on, price\_cents, monthly\_amount\_cents, previous\_recurrence\_id, effective\_from, generated\_until | CHECK `duration_minutes > 0` e `ends_on >= starts_on`; exclusion constraint por `(organization_id, contract_id, daterange(starts_on, ends_on, '[]'))` |
| `recurrence_exceptions` | recurrence\_id, occurrence\_date, kind (`SKIPPED`/`CONFLICT`/`MOVED`), reservation\_id, reason, resolved\_at, resolved\_by | `UNIQUE (recurrence_id, occurrence_date)` |
| `schedule_occupancies` | unit\_id, start\_at, end\_at, period (gerada), reservation\_id, block\_id, active | Exclusion constraint por unidade (SQL abaixo) |

Sem `reservation_holds` no MVP. Quando a página pública entrar, a tabela é criada e ganha uma coluna FK em `schedule_occupancies`.

### 5.4. Clientes

| Tabela | Campos principais | Constraints e índices |
| --- | --- | --- |
| `customers` | name, phone\_e164, email, user\_id (nulo), archived\_at, anonymized\_at | índice **não único** `(organization_id, phone_e164)`; índice trigram em `name` (extensão `pg_trgm`) para busca |
| `customer_notes` | customer\_id, body, author\_user\_id | índice `(customer_id, created_at DESC)` |

Ao cadastrar um telefone que já existe na organização, a interface mostra os clientes com o mesmo número e pergunta se é a mesma pessoa. O banco não bloqueia.

Na Fase 3, `customers` implementa somente identidade interna, nome, contato opcional, datas e arquivamento. Login de cliente (`user_id`), anonimização, notas, busca trigram e ficha financeira continuam para fases posteriores. A busca básica usa nome com `ILIKE`, filtro de organização e paginação por ID.

### 5.5. Financeiro

| Tabela | Campos principais | Constraints e índices |
| --- | --- | --- |
| `charges` | customer\_id, kind (`RESERVATION`/`MONTHLY`/`NO_SHOW_FEE`/`CANCELLATION_FEE`/`MANUAL`), reservation\_id, contract\_id, period\_month (date, dia 1), replaces\_charge\_id, description, amount\_cents, due\_date, voided\_at, voided\_by, void\_reason, created\_by | CHECK `amount_cents > 0`; índices únicos parciais para cobrança **ativa** por `(organization_id, reservation_id, kind)` e `(organization_id, contract_id, period_month)` mensal; `UNIQUE (organization_id, customer_id, id)`; índice `(organization_id, customer_id, due_date)` |
| `payments` | customer\_id, amount\_cents, method (`PIX`/`CASH`/`DEBIT`/`CREDIT`/`TRANSFER`/`OTHER`), received\_at, notes, external\_ref, created\_by, reversed\_at, reversed\_by, reversal\_reason | CHECK `amount_cents > 0`; `UNIQUE (organization_id, customer_id, id)`; índice `(organization_id, received_at DESC)` |
| `payment_allocations` | customer\_id, payment\_id, charge\_id, amount\_cents, created\_by, reversed\_at, reversed\_by | CHECK `amount_cents > 0`; FKs triplas `(organization_id, customer_id, payment_id)` e `(organization_id, customer_id, charge_id)`; índices `(payment_id)`, `(charge_id)` |
| `payment_refunds` | payment\_id, amount\_cents, refunded\_at, method, reason, created\_by | CHECK `amount_cents > 0`; índice `(organization_id, payment_id)` |

As FKs triplas impedem ligar pagamento e cobrança de clientes diferentes, mesmo dentro da mesma arena. O service também valida a identidade do cliente antes da alocação para devolver erro de domínio claro. As somas (alocado + devolvido ≤ pagamento, alocado ≤ cobrança) são garantidas com `SELECT ... FOR UPDATE` no pagamento e na cobrança, dentro da transação, e cobertas por teste de concorrência. Saldos vêm de `charge_balances` e `payment_balances`. Uma devolução não é cobrança negativa nem altera o valor histórico recebido.

### 5.6. Infraestrutura

- Tabelas da biblioteca de fila (criadas pela própria biblioteca, em schema separado `jobs`).
- `outbox_events` **não** existe no MVP.

Mais uma tabela de apresentação: `organization_themes` (organization\_id único, theme jsonb, version, published\_at, published\_by, previous\_theme), detalhada na §9.6.

### 5.7. SQL crítico (migration manual)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Ocupação física da agenda
CREATE TABLE schedule_occupancies (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  unit_id         uuid NOT NULL,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  period          tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  reservation_id  uuid NULL,
  block_id        uuid NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CHECK (num_nonnulls(reservation_id, block_id) = 1),
  FOREIGN KEY (organization_id, unit_id)        REFERENCES venue_units (organization_id, id),
  FOREIGN KEY (organization_id, reservation_id) REFERENCES reservations (organization_id, id),
  FOREIGN KEY (organization_id, block_id)       REFERENCES venue_blocks (organization_id, id),
  CONSTRAINT schedule_no_overlap
    EXCLUDE USING gist (unit_id WITH =, period WITH &&) WHERE (active)
);

CREATE INDEX schedule_occ_org_period ON schedule_occupancies
  USING gist (organization_id, period) WHERE active;
CREATE INDEX schedule_occ_reservation ON schedule_occupancies (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX schedule_occ_block ON schedule_occupancies (block_id) WHERE block_id IS NOT NULL;

-- Trechos adicionais das migrations das tabelas correspondentes
CREATE UNIQUE INDEX membership_invites_pending_org_email ON membership_invites
  (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE calendar_exceptions ADD CONSTRAINT calendar_exception_scope_date_key
  UNIQUE NULLS NOT DISTINCT (organization_id, venue_id, date);

ALTER TABLE recurrences ADD CONSTRAINT recurrence_versions_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    contract_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );

CREATE UNIQUE INDEX charges_active_reservation_kind ON charges
  (organization_id, reservation_id, kind)
  WHERE reservation_id IS NOT NULL AND voided_at IS NULL;
CREATE UNIQUE INDEX charges_active_monthly_contract_period ON charges
  (organization_id, contract_id, period_month)
  WHERE kind = 'MONTHLY' AND voided_at IS NULL;

ALTER TABLE charges ADD CONSTRAINT charges_org_customer_id_key
  UNIQUE (organization_id, customer_id, id);
ALTER TABLE payments ADD CONSTRAINT payments_org_customer_id_key
  UNIQUE (organization_id, customer_id, id);
ALTER TABLE charges ADD CONSTRAINT charges_replaces_same_customer_fk
  FOREIGN KEY (organization_id, customer_id, replaces_charge_id)
  REFERENCES charges (organization_id, customer_id, id);
ALTER TABLE payment_allocations ADD CONSTRAINT allocations_payment_same_customer_fk
  FOREIGN KEY (organization_id, customer_id, payment_id)
  REFERENCES payments (organization_id, customer_id, id);
ALTER TABLE payment_allocations ADD CONSTRAINT allocations_charge_same_customer_fk
  FOREIGN KEY (organization_id, customer_id, charge_id)
  REFERENCES charges (organization_id, customer_id, id);

-- Saldo das cobranças
CREATE VIEW charge_balances AS
SELECT c.id AS charge_id,
       c.organization_id,
       c.customer_id,
       c.amount_cents,
       COALESCE(SUM(a.amount_cents) FILTER (WHERE a.reversed_at IS NULL), 0) AS allocated_cents,
       CASE WHEN c.voided_at IS NOT NULL THEN 0
            ELSE c.amount_cents - COALESCE(SUM(a.amount_cents) FILTER (WHERE a.reversed_at IS NULL), 0)
       END AS open_cents,
       CASE WHEN c.voided_at IS NOT NULL THEN 'VOID'
            WHEN COALESCE(SUM(a.amount_cents) FILTER (WHERE a.reversed_at IS NULL), 0) = 0 THEN 'OPEN'
            WHEN COALESCE(SUM(a.amount_cents) FILTER (WHERE a.reversed_at IS NULL), 0) < c.amount_cents THEN 'PARTIAL'
            ELSE 'PAID'
       END AS status
FROM charges c
LEFT JOIN payment_allocations a ON a.organization_id = c.organization_id AND a.charge_id = c.id
GROUP BY c.id;

-- Agregações separadas evitam multiplicar linhas de alocações por devoluções
CREATE VIEW payment_balances AS
SELECT p.id AS payment_id, p.organization_id, p.customer_id, p.amount_cents,
       COALESCE(a.allocated_cents, 0) AS allocated_cents,
       COALESCE(r.refunded_cents, 0) AS refunded_cents,
       CASE WHEN p.reversed_at IS NOT NULL THEN 0
            ELSE p.amount_cents - COALESCE(a.allocated_cents, 0) - COALESCE(r.refunded_cents, 0)
       END AS free_cents
FROM payments p
LEFT JOIN LATERAL (
  SELECT SUM(amount_cents) AS allocated_cents FROM payment_allocations
  WHERE organization_id = p.organization_id AND payment_id = p.id AND reversed_at IS NULL
) a ON true
LEFT JOIN LATERAL (
  SELECT SUM(amount_cents) AS refunded_cents FROM payment_refunds
  WHERE organization_id = p.organization_id AND payment_id = p.id
) r ON true;
```

No `schema.prisma`, a coluna fica declarada como `period Unsupported("tstzrange")? @default(dbgenerated())` para o Prisma não tentar removê-la. O spike isolado da Fase 1 confirmou essa convivência em PostgreSQL 16 com Prisma 7.10.1; as constraints novas acima ainda exigem prova no modelo final. O plano B está em §16. Índices parciais são editados em migrations SQL revisadas.

### 5.8. Relações principais

- `organizations` 1—N `memberships` N—1 `users`
- `venues` N—N `venue_units` (via `venue_unit_links`)
- `reservations` 1—N `schedule_occupancies` (uma por unidade ocupada)
- `venue_blocks` 1—N `schedule_occupancies`
- `recurrence_contracts` 1—N `recurrences` (versões); `recurrences` 1—N `reservations`; `recurrences` 1—1 `recurrences` (versão anterior)
- `customers` 1—N `reservations`, `charges`, `payments`
- `payments` N—N `charges` (via `payment_allocations`); `payments` 1—N `payment_refunds`

## 6. Motor de reservas

A agenda é protegida pela exclusion constraint em `schedule_occupancies`; o código valida antes para dar boa mensagem, mas a última palavra é do banco. Toda operação de agenda é uma transação curta que grava a origem e suas ocupações juntas.

### 6.1. Estados da reserva

&#91;embedded content: estados da reserva · 5 estados, 1 derivado\]

No MVP, `PENDING` significa "anotado, aguardando confirmação do cliente" e ocupa a agenda. Não expira sozinho; o dashboard lista pendências de confirmação com início nas próximas 24 h.

| Transição | Quem | Efeito na ocupação | Efeito financeiro |
| --- | --- | --- | --- |
| criar → `PENDING` ou `CONFIRMED` | Todos | Cria ocupações ativas | Cria cobrança se `charge_on_reservation = ON_CREATE` |
| `PENDING` → `CONFIRMED` | Todos | Mantém | Cria cobrança se `ON_CONFIRM` |
| `PENDING`/`CONFIRMED` → `CANCELLED` | Ver matriz §4.4 | Desativa | Ver §6.4 |
| `CONFIRMED` → `NO_SHOW` | Todos, só após `start_at` | Mantém (histórico) | Política da plataforma vigente na reserva define efeitos; regras pendentes |
| `CONFIRMED` → `COMPLETED` | Derivado: `end_at < now()` | Mantém | Nenhum |

Qualquer transição fora da tabela devolve `409 INVALID_TRANSITION`. A máquina de estados fica em uma função pura em `packages/contracts` (usada pela Web para esconder botões e pela API para validar).

### 6.2. Ocupação com múltiplas unidades

- Ao criar uma reserva, o service lê `venue_unit_links` do venue e cria **uma ocupação por unidade**, todas com o mesmo intervalo.
- O intervalo ocupado é `[start_at, end_at + buffer_minutes)`. O intervalo exibido ao cliente continua `[start_at, end_at)`.
- **Remarcar no mesmo venue:** atualiza `start_at`/`end_at` da reserva e de todas as suas ocupações na mesma transação.
- **Trocar de venue:** desativa as ocupações antigas e cria as do novo venue na mesma transação.
- **Bloqueio de manutenção** por venue ocupa todas as unidades daquele venue (um bloqueio no "campo inteiro" bloqueia A e B; no "lado A", só A).
- Alterar os links de um venue com reservas ou bloqueios futuros ativos é recusado com `409 VENUE_UNITS_IN_USE`. Para mudar a composição física, o admin resolve ou remarca os compromissos futuros antes; a substituição dos links ocorre em uma transação. Mudança de nome de unidade não altera ocupações.
- Criação/remarcação de reserva, bloqueio e substituição de `venue_unit_links` obtêm `SELECT ... FOR UPDATE` no(s) venue(s) **antes** de ler links ou ocupações futuras. Se houver dois venues, trava por ID em ordem crescente. Assim, alteração de links e criação simultânea não observam composições diferentes.
- Invariante testada: o conjunto de `unit_id` das ocupações ativas de uma reserva é igual ao conjunto de unidades do venue no momento da criação ou remarcação.

### 6.3. Criação de reserva (uma transação)

1. Validar contrato, capacidade e `Idempotency-Key`.
2. Converter horário local → UTC pelo fuso da organização.
3. Iniciar transação e travar o venue (`FOR UPDATE`) antes de ler unidades e regras. Validar horário de funcionamento (considerando `calendar_exceptions`), alinhamento a `slot_minutes`, duração entre `min_minutes` e `max_minutes`, antecedência mínima. Admin+ pode ignorar alinhamento e antecedência com confirmação explícita.
4. Calcular preço (§6.6).
5. Inserir `reservations`.
6. Inserir `schedule_occupancies` para cada unidade.
7. Inserir `reservation_history`.
8. A partir da Fase 5, criar cobrança conforme política; até lá, a rota de reserva roda apenas em ambiente de desenvolvimento e não é liberada para piloto.
9. Gravar resposta em `idempotency_keys`.
10. Commit. Erro `23P01` → rollback, consulta as ocupações conflitantes e devolve `409 SLOT_UNAVAILABLE` com o intervalo e o tipo do conflito (reserva ou bloqueio), sem dados de outro cliente além do necessário para a equipe.

### 6.4. Remarcação, cancelamento e no-show

- **Remarcação:** usa `version` para concorrência otimista. O preço é recalculado e, se mudar, a interface mostra o novo valor antes de confirmar; a partir da Fase 5, a cobrança em aberto é ajustada (anula a antiga e cria substituta com `replaces_charge_id`, nunca edita valor). Se houver alocação, a operação exige confirmação explícita do destino do crédito.
- **Cancelamento:** conservar versão da política aplicada. Prazo gratuito, retenções, multas, devoluções e exceções dependem da decisão do fundador.
- **Cancelamento tardio:** aplicar a versão registrada na reserva. Regras financeiras aguardam definição do fundador.
- **No-show:** registrar o evento. Multas, dispensas e exceções aguardam definição da política.
- Cancelar ocorrência gera exceção na agenda. O efeito sobre a mensalidade aguarda a definição da política central.

### 6.5. Recorrências (mensalistas)

- Modelo: dia da semana + horário local + duração + `starts_on` + `ends_on` opcional + preço acordado.
- **Geração:** job diário às 03:00 no fuso de cada organização materializa ocorrências até hoje + 10 semanas e atualiza `generated_until`. Na criação da recorrência, a geração inicial roda na mesma requisição.
- Cada ocorrência é inserida em um **savepoint**: conflito (`23P01`), dia fechado em `calendar_exceptions` ou hora local inexistente não derruba as outras; vira `recurrence_exceptions` (`CONFLICT` ou `SKIPPED`) e aparece num alerta no dashboard até ser resolvida. A razão específica fica em `reason`.
- Ocorrências geradas nascem `CONFIRMED`, `source = RECURRENCE`, `price_source = RECURRENCE`.
- **Mudar só uma semana** ("só nesta terça, às 20h"): edita a reserva daquela data e registra exceção `MOVED`.
- **Mudar a recorrência** (dia, horário, venue, preço) a partir de uma data, em uma transação: (1) faz prévia de todas as ocorrências futuras afetadas; (2) se alguma tem pagamento alocado ou foi alterada individualmente, recusa com `409 RECURRENCE_REQUIRES_RESOLUTION` e lista as datas para decisão manual; (3) encerra a versão atual com `ends_on = effective_from - 1`; (4) cancela as ocorrências futuras não protegidas, com motivo "nova versão", e trata suas cobranças pela política de cancelamento acordada; (5) cria nova versão ligada ao mesmo `recurrence_contracts.id`; (6) gera as novas ocorrências. Nada da versão nova é gravado se qualquer passo falhar.
- No modo `MONTHLY`, alterar `monthly_amount_cents` só pode valer a partir do primeiro dia do mês seguinte. Uma mudança de horário ou venue no meio do mês mantém o valor mensal já acordado para aquele mês.
- **Encerrar mensalista:** encerra o contrato e sua versão ativa, cancela ocorrências posteriores e impede novas mensalidades. Ocorrências pagas e meses parciais exigem resolução antes do encerramento automático.
- **Reprocessar exceção:** `CONFLICT` e `SKIPPED` não são regeneradas automaticamente. O endpoint de resolução tenta criar ou remarcar a ocorrência em transação; sucesso marca `resolved_at`, enquanto falha mantém o alerta. O job diário só gera datas ainda não processadas.

### 6.6. Preços

Preço é por hora (`price_per_hour_cents`). O valor da reserva é a soma dos trechos: cada trecho de minutos usa a regra vigente naquele trecho, e o total é arredondado ao centavo uma única vez no final.

| Nível | Regra | Exemplo |
| --- | --- | --- |
| 0 | Preço acordado da recorrência (valor fixo por ocorrência) | Mensalista paga R$ 90 por jogo |
| 1 | Venue + data específica (+ modalidade opcional) | Feriado de 15/11 |
| 2 | Venue + modalidade + dia da semana + faixa horária | Beach tennis, sábado, 8h–12h |
| 3 | Venue + dia da semana + faixa horária | Campo 1, seg–sex, 18h–23h |
| 4 | Preço padrão do venue | Qualquer outro horário |
| — | Manual (Admin+, com motivo) | Desconto pontual |

- O nível mais baixo que cobre o trecho vence. Dentro do mesmo nível, duas regras ativas não podem se sobrepor no mesmo venue, modalidade, dia e faixa, dentro da vigência: a gravação é recusada com `409 PRICING_RULE_OVERLAP`.
- Criar, editar e arquivar regra de preço trava a linha do venue com `FOR UPDATE` antes de consultar regras concorrentes e gravar. Todas as rotas que alteram regras usam a mesma ordem de locking; duas requisições simultâneas são serializadas e a segunda revalida após a primeira. O teste de integração usa duas conexões e tenta cadastrar faixas sobrepostas.
- A reserva guarda `price_cents`, `price_source`, `pricing_rule_id` (nulo quando mais de uma regra contribuiu) e `price_breakdown` (jsonb validado, com trechos, regra aplicada, minutos e subtotal racional). O detalhamento é imutável e permite explicar o preço mesmo após alterar regras futuras. A função de cálculo é pura e testada com tabela de casos.
- Exemplo normativo: 18:30–19:30 com R$ 80/h até 19:00 e R$ 100/h depois custa `80×30/60 + 100×30/60 = R$ 90,00`; arredonda-se uma vez no final. Em virada de meia-noite, separa-se no limite da data local e aplica-se a regra do novo dia ao trecho seguinte. Vigências `valid_from` e `valid_until` são inclusivas na data local.
- A tela de cadastro mostra uma simulação "quanto custa terça 19h–20h" para o dono conferir.

### 6.7. Disponibilidade

- `GET /availability?venueId&date` devolve os slots do dia operacional: horário de funcionamento (com exceções) menos ocupações ativas de qualquer unidade do venue, alinhados a `slot_minutes`.
- Uma consulta por dia e venue, usando o índice GiST `(organization_id, period)`. A visão semanal faz uma consulta para a semana inteira, não sete.
- Disponibilidade é informativa; só a constraint garante.

### 6.8. Hipóteses operacionais de produto — validação comercial posterior

A grade padrão é de 15 min e a duração padrão da reserva é de 60 min. Manter fuso IANA, funcionamento após meia-noite e exceções de calendário. Políticas de cancelamento são centralizadas e versionadas.

## 7. Financeiro

O financeiro separa o que é devido (`charges`), o que entrou (`payments`) e como um se liga ao outro (`payment_allocations`). Nada é editado ou apagado: correções são anulação, estorno e reversão de alocação, sempre com autor e motivo.

### 7.1. Estados derivados

| Entidade | Estado | Como é calculado |
| --- | --- | --- |
| Cobrança | `VOID` | `voided_at` preenchido |
| Cobrança | `OPEN` / `PARTIAL` / `PAID` | Soma das alocações não revertidas vs. `amount_cents` (view `charge_balances`) |
| Cobrança | Vencida | `OPEN` ou `PARTIAL` e `due_date < hoje` (fuso da organização) |
| Pagamento | `REVERSED` | `reversed_at` preenchido |
| Pagamento | Saldo livre (crédito) | `amount_cents` − alocações não revertidas − devoluções |

### 7.2. Operações

| Operação | Regra |
| --- | --- |
| Registrar pagamento | Cria `payments`. Opcionalmente aloca na mesma transação (padrão da interface: cobranças em aberto mais antigas do cliente primeiro). |
| Alocar | Trava pagamento e cobrança (`FOR UPDATE`); recusa se exceder o saldo livre do pagamento ou o aberto da cobrança (`ALLOCATION_EXCEEDS_BALANCE`). |
| Reverter alocação | Marca `reversed_at`; o valor volta a ser saldo livre do pagamento. |
| Anular cobrança | Exige motivo. Se houver alocações ativas, elas são revertidas na mesma transação (o dinheiro vira crédito). |
| Substituir cobrança | Admin+ anula a cobrança anterior e cria a nova com `replaces_charge_id` na mesma transação, após tratar alocações. A nova preserva cliente, reserva ou contrato, competência e tipo; somente valor, descrição e vencimento podem mudar. Exige motivo e gera audit log. |
| Estornar lançamento de pagamento | Exige motivo e capacidade Admin+. Reverte todas as alocações do pagamento e marca `reversed_at`. Usado para lançamento errado, sem devolução de dinheiro já registrada. |
| Devolver parte de pagamento | Exige motivo, valor e capacidade Admin+. Reverte antes as alocações necessárias; trava o pagamento; cria `payment_refunds` até o saldo livre. Não marca o pagamento inteiro como estornado. |
| Corrigir valor | Nunca edita: anula e cria outra cobrança, ou estorna e registra outro pagamento. |

`payments.reversed_at` só pode ser preenchido se não houver `payment_refunds`: reversão integral de lançamento incorreto e devolução parcial são fluxos distintos. Uma devolução integral de dinheiro após registro válido usa `payment_refunds` no valor total. Relatórios distinguem valor recebido bruto e valor líquido após devoluções.

Há no máximo uma cobrança **não anulada** por reserva/tipo e uma mensalidade não anulada por contrato/mês. As anuladas permanecem no histórico. `replaces_charge_id` aponta para a cobrança anterior da mesma organização e cliente; o service verifica também tipo e vínculo lógico e impede ciclos. O job mensal consulta **qualquer** cobrança `MONTHLY` do contrato/mês, inclusive anulada, antes de criar; uma anulada nunca é recriada automaticamente. Substituição mensal é ação explícita de Admin+.

### 7.3. Pendências

Pendência é cobrança `OPEN` ou `PARTIAL`. A tela global de pendências é restrita a Proprietário e Administrador, agrupa por cliente, ordena pela mais antiga e tem botão `wa.me` com mensagem de cobrança pronta (valor, referência, chave Pix da arena configurada como texto). Funcionário só consulta cobranças abertas do cliente selecionado no fluxo de atendimento.

### 7.4. Crédito do cliente

Crédito é a soma dos saldos livres dos pagamentos não estornados do cliente, após subtrair devoluções. Não existe tabela de crédito no MVP. Usar crédito = alocar um pagamento antigo com saldo livre em uma cobrança nova. A ficha do cliente mostra "Em aberto" e "Crédito" lado a lado.

### 7.5. Mensalistas

| `billing_mode` | Como cobra | Job |
| --- | --- | --- |
| `MONTHLY` | Uma cobrança `MONTHLY` ativa por contrato e mês completo, valor da versão vigente no primeiro dia, vencimento no `monthly_billing_day` | Diário às 04:00 local: cria somente se **não existe nenhuma** cobrança mensal daquele contrato/mês, inclusive anulada; o índice único parcial evita duas ativas em concorrência |
| `PER_OCCURRENCE` | Uma cobrança `RESERVATION` por ocorrência, como reserva avulsa | Nenhum além da geração de ocorrências |

A primeira competência parcial é calculada automaticamente. A base por ocorrências, arredondamento, vigência e feriados aguardam aprovação. A inadimplência gera alerta e preserva a ocupação.

### 7.6. Relatórios do MVP

- Recebido no período, por forma de pagamento.
- Em aberto e vencido, por cliente.
- Faturamento previsto do mês (cobranças criadas) vs. recebido.
- Ocupação por venue (horas reservadas ÷ horas de funcionamento).

Todos calculados por SQL agregado no banco, com filtro de período no fuso da organização.

### 7.7. Futuro

Pix com confirmação automática via Mercado Pago integra a Fase 5 antes do lançamento comercial. Ver [proposta financeira](MERCADO_PAGO.md).

## 8. Contratos da API do MVP

O MVP tem cerca de 60 endpoints previstos, todos sob `/api/v1`. Rotas de organização usam `/api/v1/orgs/:org/...`; a coluna "Cap." indica a capacidade exigida (O = Proprietário, A = Administrador, S = Funcionário). `Idem.` marca `Idempotency-Key` obrigatório.

### 8.1. Identidade e organização

| Método e rota | Cap. | Observação |
| --- | --- | --- |
| `POST /auth/login` | público | Rate limit; define cookie |
| `POST /auth/logout` | autenticado | Revoga sessão atual |
| `GET /auth/me` | autenticado | Usuário + memberships |
| `POST /auth/password/forgot` | público | Sempre 202 (não revela e-mail) |
| `POST /auth/password/reset` | público | Token de uso único |
| `POST /auth/password/change` | autenticado | Revoga outras sessões |
| `POST /auth/invites/accept` | token de convite | Consome token de uso único, verifica e-mail e ativa membership |
| `GET /auth/sessions` · `DELETE /auth/sessions/:id` | autenticado | Gerenciar dispositivos |

As rotas organizacionais vigentes, seus campos e limites de delegação estão na [matriz HTTP da Fase 2](PHASE2_ACCESS.md).

Criação de organização no MVP é feita por script administrativo (`pnpm org:create`), não por endpoint público.

### 8.2. Estrutura da arena

| Método e rota | Cap. | Observação |
| --- | --- | --- |
| `GET/POST /orgs/:org/sports` · `PATCH /:id` | O, A (leitura: todos) |  |
| `GET/POST /orgs/:org/venues` · `PATCH/DELETE /:id` | O, A (leitura: todos) | DELETE arquiva |
| `GET/POST /orgs/:org/units` · `PATCH /:id` | O, A |  |
| `PUT /orgs/:org/venues/:id/units` | O, A | Substitui links; `409 VENUE_UNITS_IN_USE` se houver ocupações futuras |
| `PUT /orgs/:org/venues/:id/operating-hours` | O, A | Semana inteira de uma vez |
| `GET/POST /orgs/:org/calendar-exceptions` · `DELETE /:id` | O, A | Feriados e horários especiais |
| `GET/POST /orgs/:org/pricing-rules` · `PATCH/DELETE /:id` | O, A | `409 PRICING_RULE_OVERLAP` |
| `GET /orgs/:org/pricing/quote?venueId&sportId&start&end` | todos | Simulação de preço |
| `GET/POST /orgs/:org/blocks` · `POST /:id/cancel` | O, A | `409 SLOT_UNAVAILABLE` |

### 8.3. Agenda

| Método e rota | Cap. | Idem. | Observação |
| --- | --- | --- | --- |
| `GET /orgs/:org/schedule?from&to&venueIds` | todos |  | Reservas + bloqueios do período (visão dia/semana), uma consulta |
| `GET /orgs/:org/availability?venueId&date` | todos |  | Slots livres do dia operacional |
| `GET /orgs/:org/reservations?customerId&status&from&to&cursor` | todos |  | Lista paginada |
| `GET /orgs/:org/reservations/:id` | todos |  | Inclui histórico e cobranças |
| `POST /orgs/:org/reservations` | S+ | Sim | Cria avulsa |
| `PATCH /orgs/:org/reservations/:id` | S+ | Sim | Remarcar, trocar venue, notas; exige `version` |
| `POST /orgs/:org/reservations/:id/confirm` | S+ | Sim |  |
| `POST /orgs/:org/reservations/:id/cancel` | ver §4.4 | Sim | Corpo: motivo, dispensar taxa (A+) |
| `POST /orgs/:org/reservations/:id/no-show` | S+ | Sim | Staff não escolhe taxa; override com valor/motivo só A+ |
| `GET /orgs/:org/recurrences` · `GET /:id` | todos |  |  |
| `POST /orgs/:org/recurrences` | A+ | Sim | Gera ocorrências na hora; devolve conflitos |
| `POST /orgs/:org/recurrences/:id/versions` | A+ | Sim | Nova versão a partir de `effectiveFrom` |
| `POST /orgs/:org/recurrences/:id/end` | A+ | Sim | Encerrar mensalista |
| `GET /orgs/:org/recurrence-exceptions?unresolved=true` | A+ |  | Alertas do dashboard |
| `POST /orgs/:org/recurrence-exceptions/:id/resolve` | A+ | Sim | Remarcar ou ignorar |

### 8.4. Clientes

| Método e rota | Cap. | Observação |
| --- | --- | --- |
| `GET /orgs/:org/customers?q&cursor` | todos | Busca por nome (trigram) ou telefone |
| `GET /orgs/:org/customers/duplicates?phone` | todos | Usado no cadastro |
| `POST /orgs/:org/customers` · `PATCH /:id` | S+ |  |
| `GET /orgs/:org/customers/:id` | todos | Resumo: em aberto, crédito, próximas reservas |
| `POST /orgs/:org/customers/:id/archive` | O |  |
| `POST /orgs/:org/customers/:id/anonymize` | O | LGPD; irreversível; audit log |
| `GET /orgs/:org/customers/:id/export` | O | LGPD; JSON |
| `GET/POST /orgs/:org/customers/:id/notes` · `DELETE /notes/:id` | S+ |  |

### 8.5. Financeiro

| Método e rota | Cap. | Idem. | Observação |
| --- | --- | --- | --- |
| `GET /orgs/:org/charges?customerId&status&dueBefore&cursor` | A+; S apenas com `customerId` e `status=OPEN/PARTIAL` |  | Sem listagem financeira global para Staff |
| `POST /orgs/:org/charges` | A+ | Sim | Cobrança manual |
| `POST /orgs/:org/charges/:id/void` | A+ | Sim | Motivo obrigatório |
| `POST /orgs/:org/charges/:id/replace` | A+ | Sim | Anula e cria substituta vinculada, com motivo |
| `GET /orgs/:org/payments?from&to&method&cursor` | A+ |  |  |
| `POST /orgs/:org/payments` | S+ | Sim | Com alocações opcionais |
| `POST /orgs/:org/payments/:id/allocations` | S+ | Sim |  |
| `POST /orgs/:org/allocations/:id/reverse` | A+ | Sim |  |
| `POST /orgs/:org/payments/:id/reverse` | A+ | Sim | Estorno |
| `POST /orgs/:org/payments/:id/refunds` | A+ | Sim | Devolução parcial ou integral de dinheiro |
| `GET /orgs/:org/receivables` | A+ |  | Pendências globais agrupadas por cliente |
| `GET /orgs/:org/reports/summary?from&to` | A+ |  | Os 4 relatórios do §7.6 |
| `GET /orgs/:org/dashboard` | todos |  | Campos financeiros só para O/A; schema de resposta por capacidade |

### 8.6. Dashboard (4 indicadores fixos)

1. Agenda de hoje: reservas do dia por venue e ocupação em %.
2. Pendências de confirmação: `PENDING` com início nas próximas 24 h.
3. Em aberto: total de cobranças abertas e vencidas.
4. Recebido no mês vs. previsto.

Mais um bloco de alertas: exceções de recorrência não resolvidas.

Funcionário vê agenda e confirmações; os indicadores 3 e 4 e os totais financeiros dos alertas são omitidos. Proprietário e Administrador veem os quatro. O bloco de alertas financeiros inclui alertas de inadimplência.

### 8.7. Geração e consumo

- Schemas Zod em `packages/contracts/src/<modulo>/`. Cada endpoint exporta `request`, `response` e `errors`.
- OpenAPI gerado pela API em `/api/v1/docs` (só fora de produção).
- A Web usa um cliente fino (`apps/web/src/lib/api.ts`) tipado pelos contratos + TanStack Query para cache e refetch.

## 9. Identidade visual e temas por arena

Cada arena recebe uma identidade visual própria, aplicada por um **tema em JSON validado** sobre um design system único. Implantar a identidade de uma arena nova é preencher um arquivo de tema, rodar a checagem automática e publicar, sem alterar código de componentes. O tema padrão (e site exemplar) usa o design da LumixEngine.

### 9.1. Princípios

- **Um design system, muitos temas.** Componentes nunca usam cor, fonte ou raio fixos; só tokens semânticos (`bg-surface`, `text-muted`, `bg-primary`).
- **A marca muda, o significado não.** Cores de estado (confirmado, pendente, cancelado, vencido, pago) têm significado fixo em todos os temas; o tema só ajusta o tom dentro de limites, para a equipe nunca confundir um cancelamento com uma confirmação.
- **Acessibilidade garantida na gravação.** Todo tema passa por checagem automática de contraste WCAG AA (4,5:1 para texto, 3:1 para elementos de interface) antes de ser publicado.
- **Sem flash de tema errado.** O tema é resolvido no servidor (Next.js) e injetado no `<head>` antes da primeira pintura.
- **Mesma fonte para Web e Mobile.** O mesmo JSON alimenta o Tailwind na Web e o ThemeProvider do React Native na Fase 8.

### 9.2. Camadas de tokens

| Camada | O que é | Quem altera | Exemplo |
| --- | --- | --- | --- |
| Primitivos | Valores brutos da marca | Tema da arena | `brand.green = #1DBF7F` |
| Semânticos | Papel na interface, como variáveis CSS | Tema da arena (mapeia primitivos) | `--color-primary`, `--color-surface`, `--color-text-muted` |
| Estado (fixos) | Cores com significado operacional | Só o design system | `--status-confirmed`, `--status-pending`, `--status-cancelled`, `--status-overdue` |
| Componentes | Uso dos semânticos em cada componente | Só o design system | Botão primário = `bg-primary text-primary-contrast` |

### 9.3. O que um tema pode alterar

| Área | Painel administrativo | Página pública e app do cliente (futuro) |
| --- | --- | --- |
| Logo, símbolo e favicon | Sim | Sim |
| Cor primária e acento | Sim | Sim |
| Fundo, superfícies e bordas | Só escolha claro/escuro | Sim, livre (com contraste validado) |
| Fontes | Lista curada | Lista curada |
| Raio de borda | Sim (3 presets) | Sim (3 presets) |
| Imagens de capa e fotos | Não | Sim |
| Cores de estado | Não | Não |

No painel, que a equipe usa o dia inteiro, a identidade é aplicada de forma contida (marca, cor primária, modo claro/escuro) para preservar legibilidade. A expressão completa da marca fica para a página pública e o app do cliente.

### 9.4. Tema padrão: LumixEngine Dark

Extraído do site da LumixEngine: fundo quase preto azulado, superfícies em camadas sutis, verde-esmeralda como ação principal, verde-menta como acento, gradiente violeta → azul na marca, tipografia geométrica pesada nos títulos e brilho verde suave atrás de destaques.

| Token semântico | Valor | Uso |
| --- | --- | --- |
| `background` | `#0A0E15` | Fundo da página |
| `surface` | `#10151F` | Cards, painéis, tabela da agenda |
| `surface-raised` | `#161C28` | Modais, menus, mockups |
| `border` | `#1F2733` | Divisores e contornos |
| `text` | `#F4F6FA` | Títulos e texto principal |
| `text-muted` | `#9BA5B4` | Texto secundário e legendas |
| `primary` | `#1DBF7F` | Botões principais, links de ação |
| `primary-hover` | `#18A66E` | Hover do botão principal |
| `primary-contrast` | `#03140C` | Texto sobre o botão verde |
| `accent` | `#6EE7B7` | Selos, ícones de check, rótulos em destaque |
| `brand-gradient` | `#7C3AED` → `#3B82F6` | Símbolo e detalhes da marca |
| `glow` | `#1DBF7F` a 15–25% | Brilho radial atrás do hero e de botões |

Valores aproximados a partir das capturas de tela; conferir com o CSS do site da LumixEngine antes de congelar. Fonte sugerida: **Plus Jakarta Sans** (títulos 700–800, texto 400–500), também a confirmar no CSS. Raios: 8 px (campos), 12–16 px (cards), pílula (botões e selos).

Padrões visuais herdados: seções com título grande centralizado e subtítulo em `text-muted`; colunas separadas por linhas verticais finas; listas com ícone de check em `accent`; selo pequeno com ponto verde acima do título ("Projetos digitais para operações reais"); mockups de interface dentro de molduras escuras com barra de janela.

### 9.5. Contrato do tema

O tema é um JSON validado por `ThemeSchema` (Zod) em `packages/contracts/src/theme.ts`:

```json
{
  "schemaVersion": 1,
  "name": "LumixEngine Dark",
  "mode": "dark",
  "brand": {
    "displayName": "ArenaHub",
    "logo": "assets/logo.svg",
    "logoMark": "assets/mark.svg",
    "favicon": "assets/favicon.png"
  },
  "fonts": { "heading": "plus-jakarta-sans", "body": "plus-jakarta-sans" },
  "radius": "rounded",
  "colors": {
    "background": "#0A0E15",
    "surface": "#10151F",
    "surfaceRaised": "#161C28",
    "border": "#1F2733",
    "text": "#F4F6FA",
    "textMuted": "#9BA5B4",
    "primary": "#1DBF7F",
    "primaryHover": "#18A66E",
    "primaryContrast": "#03140C",
    "accent": "#6EE7B7",
    "brandGradient": ["#7C3AED", "#3B82F6"]
  },
  "effects": { "glow": true }
}
```

- `fonts` aceita só ids da lista curada (6 a 8 famílias pré-carregadas: Plus Jakarta Sans, Inter, Montserrat, Poppins, Barlow, Outfit, Bebas Neue para títulos esportivos).
- `radius`: `sharp` (4/6/8), `rounded` (8/12/16) ou `soft` (12/16/24).
- Campos ausentes herdam do tema padrão do modo (`dark` ou `light`).
- `schemaVersion` permite evoluir o contrato com migração dos temas existentes.

### 9.6. Armazenamento e aplicação

- Tabela `organization_themes`: `organization_id` (único), `theme` (jsonb), `version`, `published_at`, `published_by`, `previous_theme` (jsonb, para desfazer).
- Assets (logo, favicon, capa) em armazenamento de objetos compatível com S3, com URL pública por organização; SVG passa por sanitização no upload.
- **Web:** o layout de `/orgs/[org]` busca o tema (cache de 5 min, invalidado ao publicar), gera `:root { --color-primary: ... }` e injeta no `<head>`. O `tailwind.config` mapeia classes para essas variáveis.
- **Fontes:** todas as fontes curadas são declaradas com `next/font` e só a do tema é aplicada pela variável `--font-heading` / `--font-body`.
- **Mobile (Fase 8):** `GET /orgs/:org/theme` devolve o mesmo JSON; o app converte em objeto de tema do React Native.
- **Sem tema cadastrado:** usa LumixEngine Dark.

### 9.7. Design system

- Componentes próprios sobre primitivas acessíveis (Radix UI), no estilo shadcn/ui: o código fica no repositório (`apps/web/src/components/ui/`) e só usa tokens.
- Conjunto inicial (\~20): Button, IconButton, Input, Select, Combobox, Textarea, Checkbox, Switch, DatePicker, TimePicker, Dialog, Sheet, Dropdown, Tabs, Badge, StatusBadge, Card, Table, Toast, EmptyState, Skeleton.
- Componentes de domínio: `ScheduleGrid` (agenda dia/semana), `ReservationCard`, `MoneyInput`, `PhoneInput`, `CustomerPicker`, `ChargeStatusBadge`.
- Ícones: Lucide (mesmo estilo de traço fino do site da LumixEngine).
- **Página de preview** `/dev/theme-preview?theme=<arquivo>` (só fora de produção): mostra todos os componentes, estados, agenda e tabelas com o tema carregado. Substitui o Storybook no MVP.

### 9.8. Implantar a identidade de uma arena nova

1. Receber da arena: logo em SVG (horizontal e símbolo), cores da marca, fontes ou referências, fotos (para a futura página pública).
2. Copiar `themes/_template.json` para `themes/<org-slug>.json` e preencher.
3. Rodar `pnpm theme:check themes/<org-slug>.json`: valida o schema, calcula contraste de todos os pares texto/fundo e sugere ajuste de tom quando reprovar.
4. Abrir `/dev/theme-preview?theme=<org-slug>` e revisar painel, agenda e telas de login.
5. Rodar `pnpm theme:snapshot <org-slug>`: Playwright gera capturas das telas principais para aprovação da arena.
6. Publicar com `pnpm theme:publish <org-slug> --env production` (grava em `organization_themes` e envia assets).
7. Registrar no audit log e guardar as capturas aprovadas.

Tempo-alvo: menos de 2 horas por arena, sem mudança de código. Uma tela de edição de tema no painel do Proprietário só entra se a demanda justificar.

### 9.9. Documentação

| Arquivo | Conteúdo |
| --- | --- |
| `docs/design/DESIGN_SYSTEM.md` | Princípios, tokens, componentes, padrões de layout, do e don't |
| `docs/design/THEMING.md` | Contrato do tema, camadas, o que é alterável, aplicação Web e Mobile |
| `docs/design/NEW_ARENA_THEME.md` | Checklist da §9.8 com critérios de aprovação |
| `docs/design/BRAND_LUMIXENGINE.md` | Tema padrão, referências do site e regras de uso da marca LumixEngine |
| `themes/_template.json` | Tema mínimo comentado |
| `themes/lumixengine-dark.json` | Tema padrão |

O painel exibe "Desenvolvido por LumixEngine" no rodapé e na tela de login, em todos os temas.

## 10. Jobs, workers e atualização da agenda

No MVP, todo processamento assíncrono roda num processo `worker` com fila no próprio PostgreSQL. Não há Redis, outbox nem tempo real por push de servidor; a agenda se mantém atual por refetch.

### 10.1. Fila

- Biblioteca de fila sobre PostgreSQL (pg-boss ou graphile-worker), escolhida na Fase 1 (ADR-006). Critérios: suporte a cron por fuso, retentativas com backoff, singleton por chave e boa integração com TypeScript.
- O worker é o mesmo código da API (`apps/api/src/worker.ts`), com os mesmos services. Sem lógica de negócio exclusiva do worker.
- Jobs são idempotentes: rodar duas vezes produz o mesmo resultado. Constraints únicas protegem concorrência; quando anulados permanecem no histórico, o job também trava o contrato e consulta todas as cobranças da competência antes de criar.

### 10.2. Jobs do MVP

| Job | Frequência | O que faz | Idempotência |
| --- | --- | --- | --- |
| `recurrences.generate` | Diário, 03:00 no fuso de cada org | Materializa ocorrências até hoje + 10 semanas | `UNIQUE (recurrence_id, occurrence_date)` |
| `billing.monthly` | Diário, 04:00 local | Cria cobrança mensal dos contratos `MONTHLY` elegíveis, se não existir ativa nem anulada | Lock do contrato + consulta histórica + índice único parcial ativo |
| `cleanup.sessions` | Diário | Remove sessões expiradas há mais de 30 dias | Delete por data |
| `cleanup.idempotency` | De hora em hora | Remove chaves expiradas | Delete por data |
| `email.send` | Sob demanda | Convite, recuperação de senha | Chave por e-mail e evento |
| `ops.healthcheck` | A cada 5 min | Registra batimento do worker (monitorado externamente) | Upsert |

Cada job roda por organização em unidades pequenas (uma org por execução), para que uma org com erro não bloqueie as outras. Falha após 5 tentativas gera alerta no Sentry.

### 10.3. Atualização da agenda na Web

- TanStack Query com refetch ao focar a janela, ao reconectar e a cada 30 s na tela da agenda.
- Após qualquer mutação, invalida as consultas afetadas (agenda do período, cliente, pendências).
- Conflito real é sempre resolvido pelo banco: se dois atendentes tentarem o mesmo horário, o segundo recebe `SLOT_UNAVAILABLE` com mensagem clara e a agenda é recarregada.

### 10.4. Quando evoluir

| Sinal | Evolução |
| --- | --- |
| Atendentes reclamam de agenda desatualizada com 30 s | SSE por organização, com `LISTEN/NOTIFY` do PostgreSQL |
| Primeiro consumidor de eventos (push, WhatsApp API, webhook) | Tabela `outbox_events` + job de publicação |
| Mais de uma instância da API com SSE | Redis pub/sub ou `LISTEN/NOTIFY` dedicado |
| Página pública | `reservation_holds` + job `holds.expire` a cada minuto |

## 11. Plano de implementação

O MVP fica pronto para piloto em cerca de 13 a 14 semanas de trabalho de uma pessoa com apoio de IA. Cada fase termina num **gate** verificável; sem passar no gate, a fase seguinte não começa.

&#91;embedded content: cronograma estimado · 9 fases e trilha comercial\]

As estimativas são de esforço focado; serviços express em paralelo esticam o calendário proporcionalmente. O app Android só começa se o piloto mostrar uso real.

### 11.1. Estratégia: fatias verticais

Diferente da v2 (toda a Web na Fase 6), cada fase de 2 a 5 entrega **API + telas + testes** da sua área. Motivos: o fluxo aparece cedo para demonstrar nas conversas comerciais, erros de contrato surgem na hora e a IA trabalha com contexto pequeno e completo. A Fase 6 vira polimento e preparação de produção.

Ordem dentro de cada funcionalidade: contrato Zod → migration → service + testes de integração → rota → tela → teste E2E do fluxo principal → documentação.

### Fase 0 — Fundação (1,5 semana)

**Objetivo:** repositório pronto para receber código de domínio com qualidade automática e design system base. Protótipos e pesquisa comercial podem apoiar validação posterior.

- [ ] Monorepo pnpm com `apps/api`, `apps/web`, `packages/contracts`; TypeScript strict e `tsconfig` base
- [ ] ESLint, Prettier, regras de import entre módulos (`eslint-plugin-boundaries`)
- [ ] `docker-compose.yml` com PostgreSQL 16 e Mailpit (e-mail local)
- [ ] Fastify com health check, Pino, validação de env com Zod, handler de erros RFC 9457
- [ ] Next.js com Tailwind ligado a variáveis CSS de tema
- [ ] Tema `lumixengine-dark.json`, `ThemeSchema` e injeção no layout
- [ ] Componentes base: Button, Input, Card, Badge, Dialog, Toast, Table
- [ ] Página `/dev/theme-preview`
- [ ] GitHub Actions: lint, typecheck, test, build
- [ ] `AGENTS.md`, `docs/AI_CONTEXT.md`, `ARCHITECTURE.md`, `ENGINEERING_STANDARDS.md`, `docs/design/*`
- [ ] ADR-001 (stack), ADR-005 (domínios e cookies), ADR-007 (temas)
- [ ] Estimativa de custo mensal de infraestrutura (§13)
- [ ] Protótipo navegável estático da agenda com dados fictícios e tema padrão, para demonstração/validação posterior
- [ ] Entrevistas com 3 a 5 proprietários: **adiadas por decisão do fundador; não são gate de Fase 0, Fase 1 ou início do desenvolvimento** (§14; ADR-009)

**Gate:** `pnpm dev` sobe tudo; CI verde; preview de tema funcionando. Protótipo é preparação de demonstração. Não há requisito de agendar/concluir entrevistas para passar gate técnico.

### Fase 1 — Banco e prova técnica (concluída em 27/11/2026)

**Objetivo:** provar que a integridade da agenda funciona com a stack escolhida antes de construir sobre ela.

- [x] Spike isolado: tabelas mínimas de unidade e ocupação sem FKs de reserva/bloqueio; coluna gerada `tstzrange`, exclusion constraint, migrations e Prisma sem drift. A migration final de domínio entra na Fase 4.
- [x] Teste de concorrência: duas conexões, mesma unidade, mesmo intervalo → exatamente uma vence
- [x] Decisão registrada em ADR-004 (Prisma + SQL manual)
- [x] Infra de testes de integração com Testcontainers e banco descartável
- [x] `shared/time`: conversão local ↔ UTC, dia operacional, testes com São Paulo e Manaus
- [x] `shared/money`: tipos, precisão e formatação
- [x] Infra de idempotência (tabela, middleware, testes)
- [x] Fila em PostgreSQL escolhida (ADR-006), worker real e recuperação testada
- [x] Spike de `forTenant(ctx)` com `connect`, `upsert`, operações aninhadas, transações, SQL manual, views e agregações; limites registrados no ADR-002
- [x] Gates e CI aprovados; candidato `docs/DATABASE.md`/`docs/ERD.md` preparado; hipóteses e decisões de modelo encaminhadas à aprovação do fundador

**Gate técnico (concluído em 27/11/2026):** teste de concorrência e workflow CI verdes; ADR-003/004 aprovados; limites de `forTenant` registrados no ADR-002; testes locais e CI aprovados. Entrevistas não são requisito. O schema candidato só fica aprovado após decisão explícita do fundador; aprovação técnica da Fase 1 não congela modelo de produção.

### Fase 2 — Identidade e acesso

**Aprovada localmente em 27/11/2026.** A [matriz HTTP](PHASE2_ACCESS.md) especifica a autorização das rotas e o [gate da fase](PHASE2_GATE.md) registra as verificações e o estado do CI.

- [x] Identidade global, sessões, usuários em múltiplas organizações, convites, cargos por organização e auditoria.
- [x] Propriedade múltipla protegida no backend e no PostgreSQL. Capacidades atuais são revalidadas por requisição.
- [x] Login, logout, troca e recuperação de senha por SMTP, cookies, CSRF e limite de tentativas.
- [x] Provisionamento controlado por `org:create` e seed de duas organizações.
- [x] Configuração da arena, tema por organização e comandos `theme:check` e `theme:publish`.
- [x] Interface para conta, arenas, membros, convites, Owners e edição de cargos. Testes de isolamento, concorrência e três tamanhos de tela.
- [ ] Selecionar e homologar SMTP de produção para o piloto.

### Fase 3 — Estrutura da arena (2 semanas)

- [x] Migrations: `customers` (cadastro mínimo), `sports`, `venues`, `venue_units`, `venue_unit_links`, `venue_sports`, `operating_hours`, `calendar_exceptions`, `pricing_rules`
- [x] Cadastro, busca e seleção básicos de clientes para a reserva da Fase 4; notas, deduplicação avançada e ficha financeira ficam na Fase 5
- [x] Criação automática de unidade única para venue simples
- [x] Horários com fechamento após meia-noite
- [x] Regras de preço com lock comum do venue, validação de sobreposição por nível e função pura de cálculo; teste de duas alterações concorrentes
- [x] Endpoint de simulação de preço
- [x] Telas: venues e unidades, espaços divisíveis, horários semanais, feriados, tabela de preços com simulador, clientes básicos
- [x] Assistente de configuração inicial da arena (venues → horários → preços)

**Gate:** uma arena fictícia com campo divisível e duas quadras de beach tennis é configurada pela interface em menos de 30 minutos.

**Evidência:** cenário via Web/API/PostgreSQL concluído em 5 segundos; critérios, capturas e CI remoto aprovados em `PHASE3_GATE.md`.

### Fase 4 — Motor de reservas (3 semanas)

- [ ] Migrations: `reservations`, `reservation_history`, `schedule_occupancies` (versão final), `venue_blocks`, `recurrence_contracts`, `recurrences`, `recurrence_exceptions` (`idempotency_keys` já existe desde a Fase 1)
- [ ] Bloqueios com ocupação e tela de manutenção (primeiro uso real da constraint final)
- [ ] Service de ocupação: criar, remarcar, trocar venue, desativar; lock do venue compartilhado com edição de links; invariante de unidades testada
- [ ] Criação de reserva avulsa com validações do venue, preço, histórico e idempotência
- [ ] Mapeamento `23P01` → `SLOT_UNAVAILABLE` com detalhe do conflito
- [ ] Máquina de estados pura em `contracts`; confirmar, cancelar, no-show
- [ ] Endpoints `schedule` e `availability` com uma consulta por período
- [ ] Recorrências: criação com geração imediata, savepoint por ocorrência, exceções, nova versão, encerramento; exclusion constraint de vigência; teste de rollback da ocorrência e persistência da exceção
- [ ] Job `recurrences.generate`
- [ ] Componente `ScheduleGrid` (dia e semana, colunas por venue, unidades divisíveis lado a lado, cores de estado fixas)
- [ ] Telas: agenda, criar e editar reserva (com `CustomerPicker` simples), detalhe com histórico, mensalistas, alertas de conflito
- [ ] Testes de tempo: meia-noite, virada de mês, Manaus, horário de verão hipotético

**Gate:** testes de concorrência (avulsa × avulsa, avulsa × bloqueio, recorrência × avulsa, campo inteiro × meia quadra) verdes; agenda semanal com 300 reservas responde em menos de 300 ms no ambiente local. Os efeitos financeiros são integrados e liberados para piloto na Fase 5.

### Fase 5 — Clientes e financeiro (2,5 semanas)

- [ ] Migrations: `customer_notes`, `charges`, `payments`, `payment_allocations`, `payment_refunds`, views `charge_balances` e `payment_balances`; índices únicos parciais e FKs triplas (`customers` já existe desde a Fase 3)
- [ ] Clientes: cadastro com `PhoneInput` E.164, aviso de duplicidade, busca trigram, notas, ficha com aberto e crédito
- [ ] Cobrança automática por política (`ON_CREATE`/`ON_CONFIRM`) integrada aos fluxos da Fase 4
- [ ] Pagamentos com alocação automática (mais antigas primeiro) e manual
- [ ] Anulação, substituição de cobrança, estorno, devolução parcial/integral, reversão de alocação com motivo e audit log
- [ ] Regras financeiras de cancelamento e no-show (§6.4)
- [ ] Mercado Pago por arena: Pix, webhooks verificados, idempotência, expiração, reembolso e conciliação antes do lançamento comercial
- [ ] Job `billing.monthly` por contrato estável, sem recriar cobrança anulada; cobrança por ocorrência e primeira competência proporcional automática
- [ ] Pendências agrupadas por cliente com mensagem `wa.me`
- [ ] Mensagens prontas `wa.me`: confirmação de reserva, lembrete, cobrança (modelos editáveis por organização) e chave Pix textual
- [ ] Relatórios do §7.6
- [ ] Exportação e anonimização de cliente (LGPD)

**Gate:** teste de concorrência de alocação (dois pagamentos na mesma cobrança) verde; um mês simulado, incluindo versionamento e devolução parcial, fecha com saldo idêntico ao calculado à mão. Fluxo completo de reserva e cobrança pronto para piloto.

### Fase 6 — Preparação do piloto (1,5 semana)

- [ ] Dashboard com os 4 indicadores e alertas
- [ ] Revisão responsiva no celular (agenda em lista por dia no mobile web)
- [ ] Estados vazios, carregamento, erros e mensagens revisados (`design:ux-copy`)
- [ ] Infraestrutura de produção e staging, domínios, HTTPS, backups automáticos
- [ ] **Teste de restauração** de backup cronometrado e documentado
- [ ] Sentry, monitor de disponibilidade da API e do worker, alertas
- [ ] Termos de uso, política de privacidade e contrato revisados juridicamente
- [ ] Suíte Playwright dos fluxos críticos rodando contra staging
- [ ] Revisão de segurança (checklist do `SECURITY.md`, dependências, headers, rate limits)
- [ ] Tema da arena piloto aplicado e aprovado (§9.8)
- [ ] Seed de demonstração com dados fictícios identificados
- [ ] Manual curto de uso (1 página por perfil) e roteiro de treinamento

**Gate:** todos os critérios da §11.2 atendidos.

### 11.2. Critérios para iniciar o piloto

- [ ] Arena configura espaços, horários e preços pela interface
- [ ] Agenda impede conflitos, inclusive em espaços divisíveis
- [ ] Reservas avulsas e recorrentes funcionam com as regras acordadas
- [ ] Cobranças, pagamentos parciais e pendências corretos
- [ ] Isolamento entre organizações testado em todos os endpoints
- [ ] Backup restaurado com sucesso em ambiente separado
- [ ] Monitoramento e alertas ativos
- [ ] Documentos jurídicos assinados
- [ ] Tema da arena aprovado
- [ ] Fluxos E2E verdes em staging

### Fase 7 — Piloto em campo (4 a 8 semanas)

- [ ] Implantação assistida: cadastro dos espaços, clientes e mensalistas existentes (importação por planilha CSV, se necessário)
- [ ] Treinamento presencial da equipe (1 a 2 horas)
- [ ] Período de operação paralela com o controle antigo (1 a 2 semanas)
- [ ] Reunião semanal de 30 min com o dono: problemas, pedidos, métricas
- [ ] Correções em ciclo curto (deploy no mesmo dia para bugs críticos)
- [ ] Medir: reservas registradas/semana, conflitos evitados, pendências recuperadas, tempo por reserva, uso por perfil
- [ ] Registrar pedidos de funcionalidade em backlog com frequência e valor percebido
- [ ] Decidir preço definitivo e proposta para as próximas arenas

**Gate:** arena usando o sistema como controle principal por 4 semanas seguidas e disposição de pagar confirmada.

### Fase 8 — App Android (condicional, 6 a 8 semanas)

Só começa se o piloto mostrar demanda por uso no celular além do painel responsivo.

- [ ] Validar Expo Development Builds no monorepo pnpm (primeira tarefa)
- [ ] `apps/mobile` com navegação, tema vindo de `GET /orgs/:org/theme`, SecureStore, sessões bearer
- [ ] Perfis da equipe: agenda do dia, criar reserva, registrar pagamento, pendências
- [ ] Push notifications (introduz `outbox_events` como primeiro consumidor)
- [ ] Maestro para E2E; testes em aparelhos reais de entrada
- [ ] Publicação na Play Store (conta, política de privacidade, ficha)

### Fase 9 — Expansão por demanda

Ordem definida pelo backlog do piloto. Candidatos: página pública com holds, login do cliente final, ArenaHub Bar, Media, Events, Business, relatórios avançados, SSE.

### 11.3. Definição de pronto (toda tarefa)

1. Módulo correto e limites respeitados.
2. Contrato Zod atualizado; sem tipos duplicados.
3. Autorização por capacidade e isolamento testados.
4. Consultas com `select` explícito, sem N+1, com índice adequado.
5. Migration revisada (sem perda de dados) e reversível quando possível.
6. Testes proporcionais ao risco, verdes no CI.
7. Concorrência e erros tratados com códigos do catálogo.
8. Histórico e auditoria gravados quando aplicável.
9. Só tokens do design system na interface.
10. Documentação atualizada quando muda comportamento ou decisão.

## 12. Testes, qualidade e CI

O esforço de teste segue o risco: agenda, isolamento e financeiro têm testes de integração com PostgreSQL real e de concorrência; telas têm E2E só nos fluxos que geram dinheiro ou conflito.

### 12.1. Pirâmide

| Tipo | Ferramenta | Cobre | Onde roda |
| --- | --- | --- | --- |
| Unitário | Vitest | Funções puras: preço, máquina de estados, tempo, dinheiro, capacidades, `ThemeSchema` e contraste | Todo push |
| Integração | Vitest + Testcontainers (PostgreSQL 16) | Services com banco real, constraints, migrations, isolamento, idempotência, jobs | Todo push |
| Concorrência | Vitest + 2 conexões reais | Exclusion constraint e alocações | Todo push |
| E2E Web | Playwright | Fluxos críticos no navegador | PR para `main` e staging |
| Visual de tema | Playwright screenshots | Telas principais por tema publicado | Ao alterar tema ou componente base |
| E2E Mobile | Maestro | Fluxos do app (Fase 8) | Fase 8 |

### 12.2. Testes obrigatórios por área

- **Isolamento:** helper `expectTenantIsolation(endpoint)` executado para cada rota; falha do CI se uma rota nova não estiver registrada. Testes adicionais cobrem `connect`, `upsert`, writes aninhados, transações, SQL manual, views e agregações; leitura sem filtro de outra arena deve falhar mesmo que a FK composta exista.
- **Sessões:** usuário com duas arenas perde acesso apenas à membership removida, sem perder a sessão nem a outra arena; alteração de papel vale na requisição seguinte. Cookie e CSRF funcionam pelo mesmo host do proxy.
- **Concorrência de agenda:** avulsa × avulsa; avulsa × bloqueio; recorrência × avulsa; campo inteiro × meia quadra; remarcação × criação; criação × troca de links do venue; reservas consecutivas `[18h,19h)` e `[19h,20h)` coexistem.
- **Concorrência financeira:** dois pagamentos alocando na mesma cobrança não ultrapassam o valor; devolução simultânea e alocação não gastam o mesmo saldo; alocação entre clientes da mesma arena falha na FK; duas substituições simultâneas não criam duas cobranças ativas.
- **Cobranças:** anular e substituir reserva ou mensalidade preserva histórico; job mensal não recria competência anulada; `payment_balances` soma alocações e devoluções separadamente sem multiplicar linhas.
- **Estrutura:** duas regras de preço sobrepostas criadas em conexões concorrentes resultam em uma única regra válida; exceção global duplicada na mesma data falha; versões de recorrência sobrepostas falham na constraint; convite expirado, revogado ou reutilizado falha.
- **Idempotência:** mesma chave devolve a mesma resposta; corpo ou rota diferente devolve 409; duas requisições simultâneas executam uma vez; timeout simulado não duplica.
- **Tempo:** fechamento após meia-noite, dois turnos no dia e dia inteiro; recorrência atravessando virada de mês e ano; `America/Manaus`; hora inexistente e ambígua com tzdata fixa.
- **Preço:** tabela de casos com trechos que cruzam duas regras, meia-noite, vigência, regra de data específica, preço de mensalista, regra manual e arredondamento único.
- **Mensalistas:** mudança de versão com ocorrência paga é recusada sem resolução; contrato não recebe duas cobranças no mesmo mês; primeiro mês parcial gera cobrança proporcional automática.
- **Estados:** toda transição inválida devolve `INVALID_TRANSITION`.
- **Migrations:** banco vazio → todas as migrations → `prisma migrate diff` sem diferença (`pnpm db:check`).
- **Temas:** todo tema em `themes/` passa no `theme:check`.

### 12.3. Fluxos E2E do MVP

1. Login, troca de arena, logout.
2. Configurar venue divisível, horários e preço.
3. Criar reserva avulsa e ver conflito ao repetir o horário.
4. Criar mensalista, ver ocorrências na agenda, mudar uma semana.
5. Cancelar dentro e fora do prazo e ver o efeito na cobrança.
6. Registrar pagamento parcial, devolver uma parte e ver pendência e crédito atualizados.
7. Bloqueio de manutenção sobre horário livre e sobre horário ocupado.

### 12.4. CI (GitHub Actions)

| Job | Quando | Tempo-alvo |
| --- | --- | --- |
| lint + typecheck | Todo push | < 2 min |
| unit + integration + concorrência | Todo push | < 6 min |
| build web + api | Todo push | < 4 min |
| db:check (drift) | Todo push que toca `prisma/` | < 2 min |
| E2E Playwright | PR para `main` | < 10 min |
| Auditoria de dependências | Semanal | — |

Branch `main` protegida: merge só com CI verde. Deploy em staging automático a cada merge; produção manual com tag.

### 12.5. Desempenho

- `EXPLAIN ANALYZE` registrado em `DATABASE.md` para: agenda semanal, disponibilidade, pendências, ficha do cliente, relatórios.
- Log de consultas acima de 200 ms em staging e produção.
- Seed de carga com 1 arena, 6 venues, 200 clientes, 40 mensalistas e 12 meses de reservas para medir antes do piloto.

## 13. Infraestrutura, operação e LGPD

A infraestrutura do piloto deve caber numa fração pequena de uma mensalidade e ter backup testado. A escolha final sai da estimativa de custo da Fase 0 (ADR-008); preços de provedores mudam, então a tabela abaixo é preenchida com valores consultados na data da decisão.

### 13.1. Opções de hospedagem

| Opção | Composição | Prós | Contras |
| --- | --- | --- | --- |
| A. VPS + Docker | Uma VPS (web, api, worker em containers) + PostgreSQL gerenciado | Custo baixo e previsível; controle total | Você cuida de atualizações, TLS, deploy e logs |
| B. PaaS | Web e API em PaaS com deploy por Git + PostgreSQL do próprio PaaS ou gerenciado | Deploy simples, TLS e logs prontos | Custo cresce mais rápido por serviço |
| C. Híbrida | Web em plataforma de front-end + API e worker em VPS ou PaaS + PostgreSQL gerenciado | Web com CDN e previews; API barata | Dois provedores; atenção a cookies e domínios |

**Recomendação inicial:** PostgreSQL **gerenciado** em qualquer opção (backup e recuperação ponto a ponto incluídos), região São Paulo quando disponível para latência. Entre A e B, decidir pelo custo mensal total estimado para 1 e para 10 arenas.

| Item de custo mensal | 1 arena | 10 arenas |
| --- | --- | --- |
| Computação (web, api, worker) | a preencher | a preencher |
| PostgreSQL gerenciado + backups | a preencher | a preencher |
| Armazenamento de assets (logos, temas) | a preencher | a preencher |
| E-mail transacional | a preencher | a preencher |
| Monitoramento (Sentry, uptime) | a preencher | a preencher |
| Domínio | a preencher | a preencher |

### 13.2. Ambientes

| Ambiente | Banco | Dados | Deploy |
| --- | --- | --- | --- |
| Local | Docker Compose | Seed fictício | `pnpm dev` |
| Staging | Instância separada, menor | Seed de demonstração | Automático a cada merge em `main` |
| Produção | Gerenciado | Reais | Manual por tag, migrations antes do deploy |

Dados reais nunca vão para local ou staging. Demonstrações comerciais usam staging com dados fictícios identificados.

### 13.3. Deploy e migrations

- Migrations são aditivas por padrão (expandir → migrar dados → contrair em deploy posterior).
- Migration destrutiva exige ADR curto e backup manual imediatamente antes.
- Deploy: build → migrations → api → worker → web. Rollback de código sem rollback de banco (por isso, migrations compatíveis com a versão anterior).

### 13.4. Backup e recuperação

| Item | Meta do piloto |
| --- | --- |
| Backup automático | Diário + recuperação ponto a ponto do provedor |
| Retenção | 14 dias diários + 3 mensais |
| Cópia fora do provedor | `pg_dump` semanal criptografado em outro armazenamento |
| Perda máxima aceitável (RPO) | 24 h (ponto a ponto reduz para minutos) |
| Tempo de recuperação (RTO) | 4 h |
| Teste de restauração | Antes do piloto e depois a cada trimestre, cronometrado |

### 13.5. Monitoramento

- Sentry na Web e na API, com `organization_id` e `request_id` como tags (sem dados pessoais).
- Monitor externo de disponibilidade em `/health` (API) e na Web; alerta por e-mail e WhatsApp pessoal.
- Batimento do worker (`ops.healthcheck`) com alerta se parar por 15 min.
- Painel de banco do provedor: conexões, CPU, consultas lentas.

### 13.6. LGPD

| Tema | Decisão para o piloto |
| --- | --- |
| Papéis | Arena = controladora dos dados dos clientes dela; LumixEngine/ArenaHub = operadora. Confirmar com revisão jurídica |
| Dados coletados de clientes | Nome, telefone, e-mail opcional, histórico de reservas e pagamentos. Sem CPF no MVP |
| Base legal provável | Execução de contrato (reserva) e legítimo interesse (histórico), a validar juridicamente |
| Direitos do titular | Exportação JSON e anonimização pelo Proprietário (§8.4) |
| Retenção | Dados de cliente enquanto houver relação com a arena; após encerramento do contrato da arena, exportação entregue e exclusão em até 90 dias |
| Segurança | Criptografia em trânsito (TLS) e em repouso (provedor), menor privilégio, audit log, logs sem dados pessoais |
| Incidentes | Procedimento escrito: conter, avaliar, avisar a arena controladora, registrar |
| Documentos | Termos de uso, política de privacidade, contrato com cláusulas de tratamento de dados, procedimento de encerramento |

Não sou advogado; esses itens são o ponto de partida para a revisão jurídica prevista na Fase 6.

## 14. Trilha comercial e entrevistas

A trilha comercial é paralela ao desenvolvimento. Por decisão do fundador (ADR-009), entrevistas ficam adiadas até o produto ser funcional e maduro para apresentação; não há prazo fixo antes da Fase 2 ou do desenvolvimento das funcionalidades principais. Validação posterior alimentará a evolução do MVP e a preparação do piloto. A meta de R$ 1.500 em 7 dias segue separada, via serviços express da LumixEngine.

### 14.1. Etapas

| Semana | Ação | Resultado esperado |
| --- | --- | --- |
| Quando a demonstração estiver madura | Identificar participantes e pedir consentimento para pesquisa | Amostra adequada; nenhum contato/entrevista presumido |
| Após solução funcional | Realizar 3 a 5 entrevistas presenciais de 30 a 45 min, com roteiro/protótipo | Evidências em `docs/discovery/`, sem registrar dados pessoais desnecessários |
| Após entrevistas | Síntese: padrões, hipóteses confirmadas/contrariadas, prioridades | Proposta de ajustes no `DATABASE.md` e políticas; mudanças requerem revisão/aprovação |
| 6–10 | Demonstração em staging para as 2 ou 3 arenas mais interessadas | Candidata a piloto |
| 10–13 | Proposta de piloto com escopo, prazo e condições por escrito | Contrato assinado |
| 14+ | Piloto (Fase 7) | Evidência de uso e preço |

### 14.2. Roteiro de entrevista

**Abertura (2 min):** "Estou desenvolvendo um sistema para arenas e quero entender como vocês trabalham hoje. Não vou vender nada nesta conversa."

**Operação atual**

1. Como vocês registram uma reserva hoje? Me mostra o último registro.
2. Quantas reservas por semana, mais ou menos? Quantos espaços?
3. Já aconteceu de dois times aparecerem para o mesmo horário? Com que frequência?
4. Quem anota as reservas? Quantas pessoas mexem na agenda?
5. Qual tarefa da semana mais toma tempo ou dá dor de cabeça?

**Espaços e horários**

6. Algum campo ou quadra pode ser dividido ou juntado?
7. Os horários são de 1 hora, 1h30, 30 min? Pode começar em qualquer minuto?
8. Precisa de intervalo entre um jogo e outro?
9. Funcionam depois da meia-noite? E em feriados?
10. O preço muda por dia, horário, modalidade? Como é a tabela?

**Mensalistas**

11. Quantos mensalistas? Pagam por mês fechado ou por jogo?
12. Quando cai num feriado ou vocês fecham, o que acontece com o valor?
13. Mensalista tem preço diferente do avulso?
14. Como fica quando o mensalista troca de dia ou horário?

**Dinheiro**

15. O cliente paga antes, na hora ou depois? Aceita sinal?
16. Como vocês sabem quem está devendo hoje?
17. Quais formas de pagamento recebem? Pix é a maioria?
18. Cobram quem cancela em cima da hora ou não aparece? Quanto?

**Equipe e permissões**

19. Funcionário pode cancelar reserva ou dar desconto? Quem pode?
20. O dono quer ver o quê no fim do dia ou do mês?

**Fechamento**

21. Se um sistema resolvesse o problema que você citou na pergunta 5, quanto isso valeria por mês para você?
22. Vende comida e bebida? Faz eventos? Tem interesse em filmagem dos jogos?
23. Posso voltar daqui a algumas semanas para mostrar uma versão funcionando?

Registrar respostas literais, não interpretações. Uma página por arena.

### 14.3. Proposta de piloto

- Escopo fechado: funcionalidades do MVP (§1.1), identidade visual da arena (§9), implantação assistida, treinamento, suporte por WhatsApp em horário comercial.
- Fora do escopo, por escrito: app, página pública, bar, eventos.
- Duração, condições de pagamento e o que acontece ao fim do piloto (continuidade com mensalidade, ou exportação dos dados).
- Hipótese de preço a testar: implantação R$ 590 + mensalidade R$ 99. Alternativa a testar: implantação reduzida em troca de feedback semanal e depoimento.
- Nada é prometido verbalmente que não esteja no documento da proposta.

### 14.4. Precificação

Antes de fechar o preço para as próximas arenas, calcular com dados do piloto: custo de infraestrutura por arena (§13.1), horas de implantação e de criação de tema, horas de suporte por mês, margem desejada e valor percebido (pergunta 21).

## 15. Desenvolvimento com IA (Codex)

Cada tarefa para a IA cabe numa fatia pequena, lê só a documentação do módulo envolvido e termina com testes verdes e resumo padronizado. O arquivo `AGENTS.md` na raiz do repositório é a fonte vigente das instruções operacionais; este documento define as regras de produto e arquitetura.

### 15.1. AGENTS.md vigente

O arquivo real cobre isolamento e limites de `forTenant`, membership por requisição, agenda e locks, finanças, contratos, testes e fluxo de mudança. Ele deve ser atualizado quando uma decisão do documento mestre for aprovada, para não manter duas versões divergentes das mesmas instruções.

### 15.2. docs/AI\_CONTEXT.md

Uma página com: o que é o ArenaHub em 5 linhas, mapa de módulos e onde está cada um, glossário (venue, unidade, ocupação, recorrência, ocorrência, cobrança, alocação, tema), links para os documentos de cada área e a fase atual do roadmap. Atualizado ao fim de cada fase.

### 15.3. Modelo de pedido de tarefa

```text
Tarefa: <id> — <título>
Fase: <n>  Módulo: <módulo>
Ler: AGENTS.md, docs/AI_CONTEXT.md, <docs específicos>
Objetivo: <comportamento esperado em 2-3 linhas>
Critérios de aceite:
- <critério verificável>
- <teste que precisa existir>
Fora do escopo: <o que não fazer>
```

### 15.4. Sequência inicial de tarefas

| Id | Tarefa | Ler | Fase |
| --- | --- | --- | --- |
| T0.1 | Monorepo, TS strict, lint, Prettier, scripts | AGENTS.md | 0 |
| T0.2 | Docker Compose (PostgreSQL, Mailpit) e env com Zod | ARCHITECTURE.md | 0 |
| T0.3 | Fastify base: health, Pino, erros RFC 9457 | ENGINEERING\_STANDARDS.md | 0 |
| T0.4 | Next.js + Tailwind ligado a variáveis de tema | design/THEMING.md | 0 |
| T0.5 | `ThemeSchema`, tema LumixEngine Dark, injeção no layout, `theme:check` com contraste | design/THEMING.md | 0 |
| T0.6 | Componentes base e `/dev/theme-preview` | design/DESIGN\_SYSTEM.md | 0 |
| T0.7 | GitHub Actions | TESTING.md | 0 |
| T1.1 | Spike tstzrange + EXCLUDE + Prisma + concorrência | DATABASE.md §5.7 | 1 |
| T1.2 | Testcontainers e helpers de teste | TESTING.md | 1 |
| T1.3 | `shared/time` e `shared/money` com testes | ENGINEERING\_STANDARDS.md | 1 |
| T1.4 | Idempotência (tabela + middleware) | API\_CONTRACTS.md | 1 |
| T1.5 | Fila PostgreSQL e worker | backend/JOBS.md | 1 |
| T1.6 | `forTenant(ctx)` | SECURITY.md | 1 |
| T2.1 | Usuários, sessões, login, CSRF | SECURITY.md | 2 |
| T2.2 | Organizações, memberships, capacidades, `org:create` | SECURITY.md | 2 |
| T2.3 | Recuperação de senha e e-mail | SECURITY.md | 2 |
| T2.4 | Suíte de isolamento | TESTING.md | 2 |
| T2.5 | `organization_themes`, `theme:publish`, tema por org | design/THEMING.md | 2 |
| T3.1 | Clientes básicos: cadastro, busca e seleção | modules/CUSTOMERS.md | 3 |
| T3.2 | Venues, unidades, links e telas | modules/VENUES.md | 3 |
| T3.3 | Horários e exceções de calendário | modules/VENUES.md | 3 |
| T3.4 | Regras de preço, cálculo e simulador | modules/PRICING.md | 3 |
| T4.1 | Ocupações e bloqueios de manutenção | modules/SCHEDULING.md | 4 |

As tarefas das Fases 4 a 6 seguem os checklists da §11 com o mesmo formato, uma funcionalidade por tarefa.

### 15.5. Economia de contexto

- Uma tarefa = um módulo. Tarefas que cruzam módulos são divididas.
- Documentos por módulo em `docs/modules/` com no máximo 2 páginas.
- A IA não reescreve arquivos inteiros para mudanças pequenas e não gera relatórios longos.
- Qualidade e testes não são cortados para economizar tokens.

## 16. ADRs, riscos e decisões pendentes

Decisões arquiteturais ficam em ADRs curtos em `docs/decisions/`. ADR-003/004/006 e o gate técnico da Fase 1 foram concluídos; ADR-009 registra a estratégia de produto. Decisões pendentes no modelo são submetidas ao fundador antes das migrations relacionadas, sem depender de entrevistas prévias.

### 16.1. ADRs

| ADR | Decisão | Proposta | Fecha em |
| --- | --- | --- | --- |
| 001 | Monorepo e stack | Como §2.1 | Fase 0 |
| 002 | Multi-tenancy | Escopo explícito + FKs compostas; `forTenant` como apoio; revisar RLS após spike e antes do piloto | Fase 1 / Fase 6 |
| 003 | Modelo de ocupação | `schedule_occupancies` por unidade, FKs explícitas, `WHERE (active)` | Fase 1 |
| 004 | Prisma e exclusion constraints | `Unsupported("tstzrange")` + SQL manual; plano B abaixo | Fase 1 |
| 005 | Autenticação e domínios | Cookie na Web, bearer no Mobile, token com hash; proxy `/api` no mesmo host dedicado `app.arenahub.com.br` | Fase 0 |
| 006 | Fila de jobs | pg-boss ou graphile-worker | Fase 1 |
| 007 | Temas por arena | JSON validado + variáveis CSS + `organization_themes` | Fase 0 |
| 008 | Hospedagem | A, B ou C da §13.1 conforme custo | Fase 0 |
| 009 | Estratégia de produto | Desenvolvimento guiado pela visão do fundador; entrevistas adiadas | 27/11/2026 |
| 010 | Decisões do fundador | Identidade, acesso e direção das fases comerciais | Fase 2 |
| 011 | Domínios por organização | Domínio próprio ou subdomínio com hostname único e ativação controlada | Fases 2, 3 e 6 |
| 012 | Estrutura operacional da arena | Venues e unidades separados, horários locais, preços normalizados e lock comum | Fase 3 |

**Plano B do ADR-004:** se o Prisma gerar drift ou tentar remover a coluna gerada ou a constraint, (1) manter o Prisma para o restante e acessar `schedule_occupancies` só por SQL tipado com Kysely dentro do módulo `scheduling`, ou (2) usar `prisma migrate` só para aplicar migrations escritas à mão (sem `migrate dev` gerando SQL). Não trocar o ORM da aplicação inteira.

### 16.2. Riscos

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Escopo crescer antes do piloto | Alta | Alto | MVP fechado (§1); pedidos novos vão para backlog com valor e frequência |
| Prisma incompatível com a constraint | Média | Alto | Spike na Fase 1 antes de qualquer código de agenda; plano B pronto |
| Regras de mensalista diferem da hipótese inicial | Alta | Alto | Marcar premissas; contrato estável, versionamento, cálculo proporcional versionado, configuração somente onde prevista e migrations aditivas após feedback |
| Estimativas estouradas por serviços express em paralelo | Alta | Médio | Reservar dias fixos por semana para o ArenaHub; replanejar a cada gate |
| Requisitos/adoção divergem da visão inicial | Média | Alto | Demonstrar solução funcional quando madura, validar com 3–5 arenas e replanejar o produto antes do piloto |
| Arena abandonar o uso após o treinamento | Média | Alto | Operação paralela, acompanhamento semanal, foco no problema da pergunta 5 |
| Criação de temas consumir muito tempo por arena | Média | Médio | Contrato de tema fechado, `theme:check` automático, meta de 2 h |
| Perda de dados | Baixa | Muito alto | PostgreSQL gerenciado, backup fora do provedor, restauração testada |
| Vazamento entre arenas | Média | Muito alto | FKs compostas, filtros explícitos, suíte de isolamento ampla; decisão RLS revisada antes do piloto |
| Exposição jurídica (LGPD, contrato) | Média | Alto | Revisão jurídica antes do piloto; coleta mínima |

### 16.3. Decisões pendentes

| Tema | Depende de | Prazo |
| --- | --- | --- |
| Aprovar entidades e relações do candidato `DATABASE.md`/ERD | Fundador | Antes das migrations definitivas correspondentes |
| Múltiplos Owners e proteção do último | Aprovado pelo fundador | Fase 2 |
| Aprovar defaults de grade, duração, antecedência e buffers | Fundador; feedback comercial posterior pode reavaliar | Antes de habilitar configuração na UI |
| Aprovar política inicial de mensalista, mês parcial, feriado e cancelamento/no-show | Fundador; registrar como hipótese até validação comercial | Antes dos fluxos financeiros/agenda correspondentes |
| Confirmar escopo de staff para cancelar e ver cobrança do cliente atendido | Fundador; feedback comercial posterior pode reavaliar | Antes de publicar permissões dessas rotas |
| Validar divisibilidade de espaços e prioridade de suporte inicial | Fundador como prioridade de MVP; entrevistas posteriores informam adoção | Antes do fechamento da Fase 3 |
| Valores finais do tema LumixEngine Dark e fonte | CSS do site da LumixEngine | Fase 0 |
| Lista curada de fontes | Primeiras arenas | Fase 2 |
| Hospedagem e custo mensal | Estimativa da §13.1 | Fase 0 |
| Domínio e marca definitivos | Decisão comercial | Antes do piloto |
| Provedor de e-mail transacional | Custo e entregabilidade | Fase 2 |
| Preço de implantação e mensalidade | Piloto | Fim da Fase 7 |
| Página pública, login do cliente, app | Evidência do piloto | Fase 9 |
| Política de retenção pós-contrato | Revisão jurídica | Fase 6 |
| Base do primeiro mês proporcional automático | Fundador define arredondamento, vigência e feriados | Antes da Fase 5 |
| Funcionário pode ver pendências globais ou decidir taxa de no-show? | Decisão atual do produto: não; fundador confirma na aprovação do modelo. Pesquisa posterior pode reavaliar | Antes de rotas financeiras |
