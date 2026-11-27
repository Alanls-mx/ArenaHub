# ADR-006 — Fila PostgreSQL

Estado: **pg-boss escolhido; recuperação local demonstrada em PostgreSQL descartável; CI remoto pendente**.

## Contexto e problema

O worker precisa de agendamento, retentativas, deduplicação e recuperação sem Redis ou fila própria.

## Alternativas

`pg-boss` 12.40.0 e `graphile-worker` 0.18.0. Ambos usam PostgreSQL. `pg-boss` fornece API direta de fila, singleton por chave, retries, cron e gerenciamento de schema, compatível com Node 24; sua instalação é isolada em `arena_jobs`. `graphile-worker` também é adequado, mas exigiria adaptar API e operação para este escopo.

## Decisão e justificativa

Usar somente `pg-boss`. O entrypoint `worker.ts` registra job sintético e limpeza de idempotência. Handlers são reexecutáveis e efeitos de domínio futuros terão idempotência própria. Cron de limpeza é horário UTC; jobs comerciais por arena exigirão cálculo de próximo instante no fuso da organização antes de agendar.

## Consequências e evidências

`pnpm test:integration` demonstrou enfileiramento, execução, persistência, deduplicação, recuperação após reinicialização do worker, retry com backoff, disputa de dois workers sem duplicação e encerramento. O pg-boss não garante execução exatamente uma vez. O schema `arena_jobs` é gerenciado pela própria biblioteca.

## Hardening da Fase 1.1

Um teste em PostgreSQL descartável encerrou a conexão do handler durante a execução. O `pg-boss` registrou falha, retentou e concluiu o job; o efeito sintético usou chave única e persistiu uma vez após duas tentativas. Na época, a inicialização com PostgreSQL indisponível falhava imediatamente. Readiness da API consultava o banco; readiness específica do worker ainda não estava exposta.

Um experimento mais severo reiniciou o container PostgreSQL durante o job. A instância ativa não foi observada concluindo o job no intervalo de 30 segundos e houve encerramentos de conexão não tratados no harness. A investigação da Fase 1.2 identificou que `Testcontainers.restart()` mudou a porta publicada: o pg-boss permaneceu configurado para a porta antiga. O timeout também era menor que os padrões da fila (expiração do job 900 s; supervisão 60 s). A falha anterior não demonstrava defeito de reconexão da biblioteca.

## Fase 1.2 — recuperação operacional

**Estratégia A, nativa.** O pg-boss 12.40.0 e `pg` 8.23.1 continuaram consumindo após o banco voltar no mesmo endereço. A biblioteca mantém o loop de polling após falhas; seu pool cria novas conexões. `start({ attempts: 10_000 })` fornece retentativas de inicialização com backoff exponencial limitado a 30 s e aviso único da biblioteca. O worker usa `connectionTimeoutMillis: 2_000` e cancela a inicialização ao receber shutdown. Não foi necessário recriar instâncias, registrar handlers novamente ou acrescentar outro mecanismo de fila. As alternativas B (reinicialização interna) e C (reinício externo) ficam reservadas para falha da recuperação nativa em condições futuras.

O estado exposto por `status()` é calculado do último polling efetivo de **ambos** os consumidores (`getWipData`), do último erro e da idade da leitura. `READY` exige que os dois consumidores tenham feito fetch recente e posterior ao erro; `DEGRADED` indica falha, `RECOVERING` indica retomada parcial. O timer de observação registra apenas transições, sem repetir erros a cada polling. `STOPPING` e `STOPPED` acompanham `stop()`. Não há endpoint administrativo. Readiness da API continua separada; um `SELECT 1` não é usado como prova de readiness do worker.

O teste usa container exclusivo, banco e dados persistidos e porta do host fixa. `docker stop`/`start` e `container.restart()` atuam no **mesmo ID**. Uma barreira segura o handler após commit do efeito e antes da conclusão do job. A conexão antiga morre, o job é retentado e a chave única mantém exatamente um efeito. O teste também cobre início com banco parado, reinício ocioso, dois ciclos consecutivos, estado degradado/recuperado, um consumidor por fila, limite de conexões, cancelamento durante startup e shutdown durante outage. Jobs terminais são consultáveis como `failed`. Os parâmetros `superviseIntervalSeconds: 1`, `monitorIntervalSeconds: 1`, `expireInSeconds: 5` e polling 0,5 s são **somente da fixture**; a configuração operacional permanece nos defaults da biblioteca (supervisão 60 s, expiração 900 s, polling 2 s) até haver handlers de domínio com duração conhecida.

Três execuções consecutivas da suíte específica passaram. Os dois ciclos de retomada de consumo em cada execução levaram, desde o comando de restauração: **3818/3630 ms**, **3853/3820 ms** e **3836/3627 ms**. Uma quarta execução após acrescentar asserts de logs também passou (3832/3860 ms; job ativo 1725 ms desde o início do restart até a conclusão). Esses números são observações locais, não SLA nem benchmark de produção. A suíte completa passou localmente com 49 testes de integração; o CI remoto ainda precisa ser executado.

**Garantia demonstrada:** jobs persistidos sobreviveram à indisponibilidade testada; o worker retomou consumo sem intervenção manual; efeitos idempotentes não duplicaram. Handlers podem executar mais de uma vez. Permanecem sem prova: recovery em PostgreSQL gerenciado/proxy, outages muito longos, latência sob carga e CI remoto.
