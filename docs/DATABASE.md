# Banco de dados

## Implementado na Fase 1

O schema PostgreSQL `occupancy_spike` possui `schedule_units`, `schedule_occupancies` e `idempotency_records` experimentais. O período é `tstzrange` gerado `[start_at,end_at)`; `btree_gist` e `schedule_no_overlap` impedem sobreposição ativa na mesma unidade. A FK `(organization_id,unit_id)` impede ocupar unidade de outra arena. `idempotency_records` usa unicidade `(organization_id,user_id,key)` e armazena intenção, hash e resposta na transação da operação. FKs para usuários e organizações definitivos serão acrescentadas na Fase 2.

`arena_jobs` é administrado exclusivamente pelo `pg-boss`; não é parte das migrations Prisma. O schema experimental não é o modelo de produção.

## Modelo definitivo planejado, sujeito a entrevistas

Separar venue comercializável de unidade física, contrato de mensalista de versão de recorrência e cobrança de pagamento/alocação. As próximas migrations deverão garantir FKs tenant compostas, identidade do mesmo cliente em pagamento/cobrança/alocação, índice parcial para cobrança ativa e `replaces_charge_id`, unicidade de exceção de calendário com `NULLS NOT DISTINCT` ou índices parciais, exclusão de versões recorrentes sobrepostas e views de saldo que agreguem alocações e devoluções separadamente. Regras de preço e links de unidades usam lock de venue em ordem crescente.

Essas tabelas e constraints **não estão implementadas**. A modelagem final não será congelada sem três a cinco entrevistas com proprietários. Veja [roteiro](INTERVIEWS.md).
