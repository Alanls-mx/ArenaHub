# Testes

`pnpm test` executa testes unitários reais da API. `pnpm test:integration` cria PostgreSQL 16 descartável com Testcontainers, nome e token aleatórios, aplica as migrations experimentais, compara Prisma schema e banco, verifica constraints SQL e executa Vitest. A URL e o token são passados apenas aos subprocessos da suíte; `DATABASE_URL` herdado é removido. O guard valida nome, usuário, host e marcador antes de qualquer fixture. O container é encerrado em `finally` mesmo após falha.

Cobertura atual: ocupação semiaberta, conflitos e concorrência por duas conexões, FK composta, rollback, múltiplas unidades, objetos do catálogo; limites da extensão tenant; idempotência e corrida por chave; execução, deduplicação e recuperação de job; datas, dinheiro, health e proteção do banco. O runner falha quando Docker não está disponível.

`pnpm db:check` verifica o **banco de desenvolvimento** contra o schema Prisma e consulta as garantias SQL do schema `occupancy_spike`. O runner usa as mesmas duas verificações no banco descartável. Nenhum comando faz reset automático no banco de desenvolvimento. O schema experimental não deve ser implantado em produção.
