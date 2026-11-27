# Banco de dados

## Implementado na Fase 1

O schema PostgreSQL `occupancy_spike` possui `schedule_units`, `schedule_occupancies` e `idempotency_records` experimentais. O período é `tstzrange` gerado `[start_at,end_at)`; `btree_gist` e `schedule_no_overlap` impedem sobreposição ativa na mesma unidade. A FK `(organization_id,unit_id)` impede ocupar unidade de outra arena. `idempotency_records` usa unicidade `(organization_id,user_id,key)` e armazena intenção, hash e resposta na transação da operação. FKs para usuários e organizações definitivos serão acrescentadas na Fase 2.

`arena_jobs` é administrado exclusivamente pelo `pg-boss`; não é parte das migrations Prisma. O schema experimental não é o modelo de produção.

## Modelo da Fase 2

As migrations `20261127010000_identity` e `20261127011000_organization_settings` criam o schema `arena_identity`, o fuso da organização e os temas versionados. O modelo Prisma de identidade está em apps/api/prisma/identity.prisma. O SQL da migration é a referência das colunas, constraints e índices. O [ERD](ERD.md) mostra as cardinalidades. As identidades e sessões são globais. E-mail é normalizado, membership tem chave composta e os cargos somam capacidades do catálogo. Ownership é independente do RBAC. O provisionamento e as mudanças de propriedade usam transações. As mutações administrativas travam a organização, revalidam o ator e só confirmam o efeito com auditoria.

A migration `20261127012000_owner_integrity` valida a existência de Owner no commit inclusive em desativação global de usuário e protege a auditoria contra edição, exclusão e truncamento.

A migration `20261127013000_organization_domains` acrescenta `organization_domains`, com hostname globalmente único, associação à organização, tipo de domínio e estado de ativação. O resolvedor atende somente hosts ativos e vincula o host ao slug usado na rota. O cadastro, a verificação DNS e a ativação operacional pertencem às fases seguintes, conforme [ADR-011](decisions/ADR-011-organization-domains.md).

As verificações semânticas do spike continuam separadas. As tabelas da fila são administradas por pg-boss. Identidade usa o pool da API com transações e search_path local. RLS continua experimental conforme ADR-002.

## Modelo comercial planejado

As fases 3 e 4 modelam clientes, venues, unidades e ocupações. Reservas duram 60 minutos por padrão e a grade padrão é de 15 minutos; o período ocupado é contínuo e semiaberto. Versões da política única da plataforma ficam associadas às reservas. Prazo, multa, no-show, tratamento de mensalistas e exceções permanecem pendentes.

A Fase 5 acrescenta contratos e competências com primeiro mês proporcional automático. Atraso gera alerta e preserva reservas. A base por ocorrências é proposta e depende da definição de feriados, vigência e arredondamento. Cobranças, pagamentos, estornos e alocações preservam histórico e cliente. A primeira versão comercial exige Pix confirmado automaticamente para a arena beneficiária. Ver [plano Mercado Pago](MERCADO_PAGO.md) e [matriz de impacto](decisions/ADR-010-product-and-access.md).

### Constraints e integridade candidatas

Estas garantias são propostas para migration SQL revisada; nenhuma delas é declarada já implementada no schema final:

1. FKs compostas com `organization_id` em referências tenant; alocações carregam `customer_id` nas FKs triplas a `payments` e `charges`.
2. `schedule_occupancies`: `CHECK (end_at > start_at)`, origem exatamente uma entre reservation/block, range `[)` gerado, FK tenant para unidade/origem e `EXCLUDE USING gist (unit_id WITH =, period WITH &&) WHERE active`.
3. Exceções de calendário: unicidade `(organization_id, venue_id, date)` com `NULLS NOT DISTINCT` em PostgreSQL 15+, ou índices parciais equivalentes se compatibilidade exigir.
4. Versões recorrentes do mesmo contrato não sobrepõem vigência: `EXCLUDE` em `organization_id`, `contract_id` e `daterange`; rever vigência aberta e domínio de datas no DDL.
5. Cobranças de reserva e mensalidade usam índices únicos parciais somente para cobranças não anuladas. `replaces_charge_id` aponta para mesma organização e cliente; service valida tipo/vínculo e ciclos.
6. Unicidade lógica mensal inclui anuladas no job de geração, embora o índice parcial só impeça duplicação de cobrança ativa. Recriação é ação administrativa explícita.
7. Views de saldo somam alocações e devoluções separadamente. `SELECT ... FOR UPDATE` em pagamento e cobrança serializa alterações; checar somas e concorrência por teste real.
8. Concorrência entre reserva, bloqueio, alteração de composição de unidades e preço usa o mesmo lock de venue; múltiplos venues são travados em ordem crescente de ID.
9. Regras de preço precisam de uma representação normalizada de escopo/faixa temporal e garantia contra sobreposição concorrente. Recomendação: lock de venue em transação compartilhado por todos os escritores e validação após lock; avaliar constraint de exclusão SQL por nível quando o esquema de intervalos estiver normalizado.
