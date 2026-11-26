# ADR-006 — Fila PostgreSQL

Estado: **pg-boss escolhido e spike funcional; cobertura operacional adicional pendente**.

## Contexto e problema

O worker precisa de agendamento, retentativas, deduplicação e recuperação sem Redis ou fila própria.

## Alternativas

`pg-boss` 12.40.0 e `graphile-worker` 0.18.0. Ambos usam PostgreSQL. `pg-boss` fornece API direta de fila, singleton por chave, retries, cron e gerenciamento de schema, compatível com Node 24; sua instalação é isolada em `arena_jobs`. `graphile-worker` também é adequado, mas exigiria adaptar API e operação para este escopo.

## Decisão e justificativa

Usar somente `pg-boss`. O entrypoint `worker.ts` registra job sintético e limpeza de idempotência. Handlers são reexecutáveis e efeitos de domínio futuros terão idempotência própria. Cron de limpeza é horário UTC; jobs comerciais por arena exigirão cálculo de próximo instante no fuso da organização antes de agendar.

## Consequências e evidências

`pnpm test:integration` demonstrou enfileiramento, execução, persistência, deduplicação, recuperação após reinicialização, retry com backoff, disputa de dois workers sem duplicação e encerramento. Falha de banco durante execução ainda precisa de teste específico. O pg-boss não garante execução exatamente uma vez. O schema `arena_jobs` é gerenciado pela própria biblioteca.
