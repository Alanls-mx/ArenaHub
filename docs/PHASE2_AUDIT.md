# Auditoria direcionada da Fase 2 — 27/11/2026

**Veredito: APROVADO TECNICAMENTE EM AMBIENTE LOCAL.** O CI remoto desta branch ainda não foi executado. Esta auditoria revalidou a implementação do commit `dba11e2` e as correções locais descritas abaixo; não constitui aprovação de deploy nem ativação comercial de domínios.

Branch: `feat/phase-2-identity-access`, base `be96251`. Árvore local com alterações da auditoria, sem commit, push, merge ou deploy. Os relatórios históricos da Fase 1 foram preservados.

## Mapa do sistema auditado

Navegador → Next.js (`apps/web/src/app/access-client.tsx`) → rewrite `/api/v1` (`apps/web/next.config.ts`) → Fastify (`apps/api/src/app.ts`) → resolvedor de host (`identity/host.ts`) → sessão/CSRF (`identity/session.ts`) → membership e capabilities (`identity/team.ts`) → transação com `search_path` local (`identity/core.ts`) → tabelas e triggers de `arena_identity`. Convites e resets enviam links por SMTP; a UI consome as respostas da API. `occupancy_spike` e `arena_jobs` permanecem separados; não participam das transações de identidade. O Next não implementa as regras de autorização.

No rewrite atual, Next encaminha `Host` interno e `X-Forwarded-Host` público. A API aceita o host encaminhado somente se o `Host` interno e o IP do peer coincidirem com `PROXY_INTERNAL_HOST` e `TRUSTED_PROXY_IPS`; o Fastify mantém `trustProxy: false`. O resolvedor normaliza o hostname, consulta apenas domínio ativo de organização ativa e associa a requisição à arena. A rota com slug verifica essa associação antes da membership. Erros de conexão com PostgreSQL são falhas da requisição; não há fallback de arena ou cache de autorização. Ativação comercial de DNS, TLS e login entre domínios independentes permanece fora da Fase 2.

## Matriz das 12 decisões do fundador

| Nº  | Decisão                                          | Estado verificado                                                                                                              |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Múltiplos Owners                                 | Implementado; rotas, lock de organização e trigger adiada protegem o último Owner.                                             |
| 2   | Identidade global e múltiplas memberships        | Implementado; revogação de uma arena preserva a sessão e outra membership.                                                     |
| 3   | Cargos e permissões personalizados               | Implementado; catálogo, editor, união de capacidades e limites de delegação no backend.                                        |
| 4   | Grade padrão de 15 minutos                       | Decisão registrada para a agenda da Fase 4; ainda não há agenda de produto.                                                    |
| 5   | Reserva padrão de 60 minutos                     | Decisão registrada para a Fase 4; ainda não há reserva de produto.                                                             |
| 6   | Política única de cancelamento                   | Decisão registrada; implementação e detalhes comerciais pertencem às Fases 4/5.                                                |
| 7   | Primeiro mês proporcional automático             | Decisão registrada; base, vigência e arredondamento seguem pendentes da Fase 5.                                                |
| 8   | Alertas sem cancelamento automático              | Decisão registrada para cobranças da Fase 5.                                                                                   |
| 9   | Staff registra pagamento sem financeiro completo | Capabilities distintas no catálogo e templates; endpoints financeiros ainda não existem.                                       |
| 10  | Espaços divisíveis                               | Modelo candidato em DATABASE/ERD; implementação Fases 3/4.                                                                     |
| 11  | Pix Mercado Pago antes do lançamento             | Requisito e plano registrados; integração e homologação pendentes da Fase 5.                                                   |
| 12  | Domínio próprio ou subdomínio                    | Omitido na base auditada; fundação F2 implementada em migration, resolvedor, testes e ADR-011. Administração F3 e ativação F6. |

As decisões 4–11 são requisitos preservados, não funcionalidades declaradas prontas na Fase 2. A matriz vigente está no [ADR-010](decisions/ADR-010-product-and-access.md).

## Segurança e integridade

- **Autenticação:** Argon2id com sal aleatório, e-mail normalizado, erro uniforme no login e no pedido de reset, limitação de tentativas, token opaco com hash SHA-256 no banco, cookie `__Host-session` Secure/HttpOnly/SameSite=Lax, prazo deslizante e absoluto, CSRF vinculado à sessão e origem estrita nas mutações. Troca e reset de senha revogam sessões; reset consome token no banco. Convite guarda apenas hash, expira, é revogável e tem uso único; a aceitação revalida remetente, organização e senha. Teste real SMTP/Mailpit e navegador passou. Entregabilidade e credenciais de SMTP de produção requerem homologação antes do lançamento.
- **RBAC:** a matriz em [PHASE2_ACCESS](PHASE2_ACCESS.md) corresponde às rotas de identidade. Uma rota sem capacidade necessária devolve 403; ausência de membership e recurso externo devolve 404. O backend impede cargo externo, delegação superior, autopromoção e alteração de outro Owner por cargo. Ownership não é uma capability editável. O catálogo contém `payments.record` separado de `finance.read`; como não há API financeira, a separação operacional será revalidada na Fase 5.
- **Ownership e auditoria:** mutações administrativas travam a organização, revalidam ator e registram auditoria na mesma transação. O teste concorrente de remoção de Owners espera 200 e 409. SQL direto recusou remover o último Owner e desativar sua conta; a trigger também foi exercida com papel `NOSUPERUSER` e permissões restritas. Auditoria recusa DELETE por SQL direto. A infraestrutura local usa superusuário para migrations; papéis de runtime e migration devem ser separados no deploy.
- **Multi-tenant:** sessões globais não autorizam arena por si. Cada rota organizacional resolve organização ativa, exige membership ativa e consulta cargos e dados por `organization_id`. FKs compostas protegem atribuições. Testes HTTP negativos cobrem duas arenas, cargo externo, revogação imediata, host de outra arena e host desconhecido. O spike de Prisma do ADR-002 demonstra por que `forTenant` não é barreira de segurança. Para os endpoints atuais, filtros, FKs e testes negativos sustentam o gate local. RLS permanece decisão provisória: reavaliar antes do piloto e quando novos caminhos de dados tenant, workers ou SQL manual forem introduzidos.
- **Domínios:** slug seguro de até 63 caracteres e nomes reservados são impostos no banco e no provisionamento. Hostname é globalmente único; status e timestamp de ativação são coerentes por CHECK. Host pendente/suspenso, inválido ou desconhecido recebe 404. Domínio ativo não abre rota de outra arena e `/auth/me` expõe apenas a arena vinculada. Cabeçalho encaminhado de chamada direta é ignorado. Cookies são por host: a origem central não compartilha cookie com domínio próprio. O login em domínio customizado ainda não é operacional; o ADR-011 define entrada separada ou troca futura de código de uso único, destino autorizado, CSRF, revogação e validação da membership, sem token de sessão na URL ou cookies de terceiros.

## Achados e resolução

| ID  | Severidade e local                                                                         | Evidência, reprodução e impacto                                                                                                                                                                                             | Resolução e bloqueio                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | P1 — `docs/decisions/ADR-010-product-and-access.md:18`, `apps/api/src/identity/host.ts:50` | A base tinha 11 decisões e nenhum modelo/resolução de domínio. Reprodução: buscar a decisão 12 em ADR, schema, migrations e rotas da base; a arena não tinha vínculo com hostname.                                          | ADR-011, migration de domínios, guarda de host e testes. **Resolvido; não bloqueia.**                                                                   |
| A2  | P1 — `apps/api/src/identity/host.ts:55`, `apps/api/src/app.ts:64`                          | Primeiro `pnpm --filter @arenahub/api test:integration --visual`: Next enviou `Host: 127.0.0.1:3001` e `X-Forwarded-Host: localhost:34871`; login e `/auth/me` receberam 404. A UI não autenticava.                         | Proxy interno e peer IP explicitamente confiáveis, mais teste HTTP e navegador real. Chamadas diretas ignoram o cabeçalho. **Resolvido; não bloqueia.** |
| A3  | P2 — `apps/api/scripts/check-schema.mjs:78`                                                | Antes, `db:check` verificava FKs e catálogo, mas não constatava triggers de Owner/auditoria nem unicidade de hostname. Reprodução: comparar consultas do script com migrations. Uma regressão SQL poderia passar pelo gate. | Verificações de catálogo PostgreSQL acrescentadas; SQL direto testado com papel sem superusuário. **Resolvido.**                                        |
| A4  | P2 — `apps/api/scripts/visual-identity.ts:58`, `:124`                                      | Ao reproduzir a falha A2, o locator imprimiu timeout, mas o runner terminou com código 0 devido ao tratamento global de exceção do Next. CI poderia sinalizar sucesso falso.                                                | Falha marca `process.exitCode = 1` e inclui status/caminho das respostas da API, sem tokens. **Resolvido.**                                             |
| A5  | P2 — `.github/workflows/ci.yml:18`                                                         | Aviso de manutenção de runtime já registrado em execução anterior; workflow usa `checkout@v4`, `pnpm/action-setup@v4`, `setup-node@v4`. Reproduzir no próximo CI remoto.                                                    | Atualização pontual em rodada posterior. **Não bloqueia o gate local.**                                                                                 |

Nenhum P0 ou P1 permanece conhecido. A classificação considera o escopo implementado; hospedagem e pagamentos futuros não foram tratados como falhas atuais.

## Verificações independentes

| Verificação                                             | Resultado                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                             | Aprovado                                                                                                      |
| `pnpm format:check`                                     | Aprovado após formatação dos documentos                                                                       |
| `pnpm typecheck`                                        | Aprovado                                                                                                      |
| `pnpm test`                                             | 19/19 em seis arquivos                                                                                        |
| `pnpm test:integration`                                 | 59/59 em dez arquivos; PostgreSQL 16 descartável                                                              |
| `pnpm db:check`                                         | Aprovado no runner descartável: ocupação, Prisma identity, FKs, catálogo, triggers e índice global de domínio |
| `pnpm build`                                            | API, Web e contratos aprovados                                                                                |
| `pnpm --filter @arenahub/api test:integration --visual` | Aprovado com Next, Fastify, PostgreSQL, Chrome e Mailpit reais                                                |
| `git diff --check`                                      | Aprovado                                                                                                      |

Uma prova de falha com locator deliberadamente impossível fez o runner visual retornar código 1. A assertion original foi restaurada e o fluxo passou novamente. As sete migrations foram aplicadas do zero em banco descartável, incluindo as três migrations de identidade da base e a migration aditiva de domínios. As duas comparações Prisma não detectaram drift. O teste cobre SQL direto do último Owner com papel restrito. O workflow executa instalação congelada, lint, formatação, typecheck, unitários, Docker/Testcontainers (migrations e `db:check`) e build; o CI remoto ainda precisa executar sobre o commit publicado.

No navegador, foram exercidos login por teclado, troca de arena, editor de cargos, convite por SMTP/Mailpit, aceitação e reset de senha. Capturas reais em [1440 × 900](evidence/phase2/1440x900.png), [768 × 1024](evidence/phase2/768x1024.png) e [390 × 844](evidence/phase2/390x844.png) foram inspecionadas: controles legíveis e sem overflow horizontal. Há estados de carregamento, erro, lista vazia e ocultação de ações sem capacidade na UI; a negação efetiva é comprovada nos testes HTTP. Não foi executada auditoria WCAG completa ou leitor de tela.

## Preparação para publicação

Conteúdo sugerido do PR para `main`, após autorização para commit/push:

**Título:** `feat: audit phase 2 identity and add organization domain foundation`

**Descrição:** Revalida identidade global, sessões, RBAC, ownership, isolamento e interfaces da Fase 2. Registra a 12ª decisão do fundador e acrescenta domínio por organização com hostname único, estados e resolução segura por proxy interno confiável. Amplia `db:check`, prova SQL do último Owner sob papel restrito e torna a validação visual sensível a falhas. Gates locais: 19 unitários, 59 integrações, sete migrations, checks Prisma/SQL, build e navegador com Mailpit. CI remoto pendente. Não ativa DNS/TLS nem login comercial em domínio personalizado.

Revisar `git status`, o diff final e eventuais segredos antes de publicar. Nenhuma credencial real, token ou dado real deve entrar no PR; `.env` e saídas temporárias permanecem ignorados. `.env.example` contém apenas credenciais locais de exemplo. A aprovação definitiva da Fase 2 depende do CI remoto no SHA publicado. Não iniciar a Fase 3 por este relatório.
