# Testes

`pnpm test` executa testes unitários reais da API. `pnpm test:integration` cria PostgreSQL 16 descartável com Testcontainers, nome e token aleatórios, aplica as migrations experimentais, compara Prisma schema e banco, verifica constraints SQL e executa Vitest. A URL e o token são passados apenas aos subprocessos da suíte; `DATABASE_URL` herdado é removido. O guard valida nome, usuário, host e marcador antes de qualquer fixture. O container é encerrado em `finally` mesmo após falha.

Cobertura atual: ocupação semiaberta, conflitos e concorrência por duas conexões, FK composta, rollback, múltiplas unidades, objetos do catálogo; matriz tenant e spike RLS; idempotência e corrida por chave; execução, deduplicação e recuperação de job; datas, dinheiro, health e proteção do banco. O runner falha quando Docker não está disponível.

`pnpm --filter @arenahub/api test:integration jobs-outage.integration.test.ts --reporter=verbose` executa só a suíte operacional, ainda com migrations e `db:check` no banco descartável criado pelo runner. O teste cria **outro container descartável** com porta de host fixa porque `Testcontainers.restart()` pode alterar uma porta dinâmica. `docker stop` e `docker start` preservam o mesmo ID e os dados; o teste verifica explicitamente o efeito persistido e o retorno do consumo. O Docker CLI precisa estar disponível ao runner. A suíte operacional não é pulada no CI: `pnpm test:integration` a inclui. Três execuções consecutivas passaram na Fase 1.2; tempos e limites constam no ADR-006.

`pnpm db:check` verifica o **banco de desenvolvimento** contra o schema Prisma e consulta as garantias SQL do schema `occupancy_spike`. O runner usa as mesmas duas verificações no banco descartável. Nenhum comando faz reset automático no banco de desenvolvimento. O schema experimental não deve ser implantado em produção.

## Identidade e acesso

O runner aplica as migrations em PostgreSQL 16 descartável, compara os schemas Prisma de ocupação e identidade, verifica as FKs de atribuição, catálogo, triggers de ownership/auditoria e índice global de hostname, e executa os testes HTTP. Para a regressão isolada, use `pnpm --filter @arenahub/api test:integration access.integration.test.ts`. Após `pnpm build`, use `pnpm --filter @arenahub/api test:integration --visual` com Chrome instalado e portas locais 3001/34871 disponíveis. O teste provisiona uma conta sintética em duas arenas, autentica pelo proxy interno confiável, abre o editor e registra as três resoluções em docs/evidence/phase2. Falha do fluxo visual deve retornar código de saída não zero.

O fluxo visual também aceita o convite enviado pelo SMTP e recupera a senha pelo link entregue no Mailpit. O seed local reproduz as duas arenas usadas na validação. Rode `pnpm db:seed` com um objeto JSON pela entrada padrão contendo o campo password, no banco local arenahub. Repetir o seed preserva a senha existente.

## Estrutura operacional da Fase 3

`pnpm test:integration` aplica a migration operacional no PostgreSQL descartável, compara `identity.prisma`, inspeciona FKs compostas, unicidade de exceção global, CHECKs de horários/preços e os triggers diferidos de composição. `structure.integration.test.ts` exercita endpoints reais com duas arenas, papel Staff, composição compartilhada, referências cruzadas, exceção global, simulador sem escrita e duas alterações concorrentes de preço. `rules.test.ts` valida horários atravessando a semana, precedência, ausência de preço e arredondamento.

Após `pnpm build`, execute `pnpm --filter @arenahub/api test:integration --visual-phase3`. O runner cria banco descartável; o script provisiona apenas a conta inicial, configura os dados operacionais pela Web em navegador Chrome, confere persistência SQL e grava screenshots nas três resoluções em `docs/evidence/phase3/`. Nenhum seed ou SQL insere modalidades, venues, unidades, horários, preços ou clientes nesse cenário.

`pnpm openapi:check` compara `docs/OPENAPI_PHASE3.json` com a geração atual dos schemas Zod compartilhados e a matriz de rotas. O workflow de CI executa essa checagem após `typecheck`.
