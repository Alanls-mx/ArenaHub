# ADR-007 — Biblioteca temporal

Estado: **implementada e validada por testes unitários**.

## Contexto e problema

Reservas usam instantes UTC; horários recorrentes e dia operacional usam tempo civil da arena. DST pode criar horário inexistente ou ambíguo.

## Alternativas

`date-fns-tz` facilita formatação e conversões, mas exige regras adicionais para ambiguidade. `@js-temporal/polyfill` 0.5.1 oferece tipos explícitos para data civil, horário, instante e fuso, com desambiguação.

## Decisão e justificativa

Usar `@js-temporal/polyfill` em `shared/time`. Horário ambíguo exige escolha `earlier` ou `later`; inexistente é recusado. Horários iguais requerem flag explícita para 24 horas. Aritmética de fuso fica centralizada.

## Consequências e evidências

Testes cobrem São Paulo, Manaus, UTC, DST de Nova York, ano bissexto, virada de ano, horário 18h–02h e intervalos consecutivos. Formatação de interface fica na Web. Não fixar São Paulo como fuso global.
