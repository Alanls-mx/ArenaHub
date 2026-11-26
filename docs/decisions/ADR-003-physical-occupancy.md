# ADR-003 — Ocupação física

Estado: **spike técnico validado; service final pendente**.

## Contexto e problema

Um venue vendável pode usar uma ou mais unidades físicas. Concorrência entre reservas e bloqueios não pode depender apenas de consulta prévia, pois duas transações podem ler disponibilidade simultaneamente.

## Alternativas

Locks apenas na aplicação, tabela única de reservas, ou ocupações por unidade com exclusion constraint PostgreSQL.

## Decisão e justificativa

Representar cada uso físico por unidade com intervalo semiaberto `[start_at,end_at)` e constraint `EXCLUDE USING gist (unit_id WITH =, period WITH &&) WHERE active`. Cada operação com múltiplas unidades ocorrerá em uma transação. O futuro service trava venue antes de ler composição/preço, e vários venues em ordem crescente de ID. A constraint é a autoridade final; SQLSTATE `23P01` será traduzido em `SLOT_UNAVAILABLE`.

## Consequências e evidências

O spike em `occupancy_spike` cobre intervalos consecutivos, sobreposição parcial/total/contida, inativos, reativação, duas conexões, rollback e operação com duas unidades. `pnpm test:integration` validou migrations e catálogo em PostgreSQL 16 real. Reserva, bloqueio e locking de venue do domínio final ainda não existem.
