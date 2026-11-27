# Operação do worker — spike da Fase 1.2

O processo `pnpm dev:worker` ou `pnpm --filter @arenahub/api start:worker` usa pg-boss 12.40.0 e `pg` 8.23.1. Jobs persistem no schema `arena_jobs` do PostgreSQL. Os handlers atuais são sintéticos e de limpeza de idempotência; não há handlers de reservas, mensalidades ou pagamentos.

## Recuperação e estados

`startWorker` usa `boss.start({ attempts: 10_000 })`. O pg-boss aplica backoff exponencial limitado a 30 s após a primeira falha de inicialização; cada tentativa de conexão tem timeout de 2 s. Um SIGTERM/SIGINT cancela o retry pendente. Durante operação, o loop de polling da biblioteca continua após erros de conexão e retoma quando o mesmo endpoint do PostgreSQL volta. A implantação deve manter endereço estável do banco.

`status()` informa `INITIALIZING`, `READY`, `DEGRADED`, `RECOVERING`, `STOPPING` ou `STOPPED`. `READY` requer fetch bem-sucedido e recente de ambos os consumidores, posterior ao último erro. A observação roda a cada segundo, registra transições e não publica endpoint HTTP. Um `SELECT 1` isolado não prova que jobs voltaram a ser consumidos. Monitorar ausência prolongada de `READY`, fila `failed` e atraso de jobs; valores de alerta devem ser definidos antes do piloto com carga real.

`stop()` encerra o pg-boss de forma graciosa com limite de 15 s e fecha o pool de limpeza. Durante outage, o teste observou parada dentro de 20 s e nenhuma conexão `pgboss` remanescente após a volta do banco. Jobs podem ser reexecutados; cada efeito de domínio precisa de chave única/transação própria. Não há garantia de execução exatamente uma vez.

## Parâmetros e limites

O worker usa pool pg-boss de até 5 conexões e pool de limpeza de até 2. Polling, supervisão, expiração e retries de jobs usam defaults da versão instalada até que a duração dos handlers definitivos seja conhecida: polling 2 s, supervisão 60 s e expiração de job 900 s. A fixture de outage usa 0,5 s, 1 s e 5 s respectivamente para medir recuperação de modo limitado; esses valores **não** são configuração de produção. Outage mais longo, proxy/PgBouncer, PostgreSQL gerenciado e desempenho com carga não foram testados.

## Verificação segura

Na raiz, `pnpm test:integration` cria o banco descartável, aplica migrations e executa `db:check`, inclusive a suíte de outage. Para executar apenas esta suíte: `pnpm --filter @arenahub/api test:integration jobs-outage.integration.test.ts --reporter=verbose`. Ela cria um segundo container descartável e reinicia **o mesmo ID**, com porta fixa e dados preservados. Docker Engine e Docker CLI são necessários. Nunca aponte esses testes para o banco de desenvolvimento ou produção.

O CI inclui a suíte por meio de `pnpm test:integration` e verifica `docker info` antes dela. Falhas em CI precisam ser investigadas no job `verify`; os testes locais não aprovam o ambiente remoto. Para publicar em branch de revisão quando autorizado: `git add` apenas os arquivos revisados, criar commit, fazer push do branch, abrir PR e conferir todos os passos do workflow. Nenhuma publicação foi realizada nesta fase.
