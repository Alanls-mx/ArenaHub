# Banco de dados

## Implementado na Fase 1

O schema PostgreSQL `occupancy_spike` possui `schedule_units`, `schedule_occupancies` e `idempotency_records` experimentais. O período é `tstzrange` gerado `[start_at,end_at)`; `btree_gist` e `schedule_no_overlap` impedem sobreposição ativa na mesma unidade. A FK `(organization_id,unit_id)` impede ocupar unidade de outra arena. `idempotency_records` usa unicidade `(organization_id,user_id,key)` e armazena intenção, hash e resposta na transação da operação. FKs para usuários e organizações definitivos serão acrescentadas na Fase 2.

`arena_jobs` é administrado exclusivamente pelo `pg-boss`; não é parte das migrations Prisma. O schema experimental não é o modelo de produção.

## Modelo da Fase 2

As migrations `20261127010000_identity` e `20261127011000_organization_settings` criam o schema `arena_identity`, o fuso da organização e os temas versionados. O modelo Prisma de identidade está em apps/api/prisma/identity.prisma. O SQL da migration é a referência das colunas, constraints e índices. O [ERD](ERD.md) mostra as cardinalidades. As identidades e sessões são globais. E-mail é normalizado, membership tem chave composta e os cargos somam capacidades do catálogo. Ownership é independente do RBAC. O provisionamento e as mudanças de propriedade usam transações. As mutações administrativas travam a organização, revalidam o ator e só confirmam o efeito com auditoria.

A migration `20261127012000_owner_integrity` valida a existência de Owner no commit inclusive em desativação global de usuário e protege a auditoria contra edição, exclusão e truncamento.

A migration `20261127013000_organization_domains` acrescenta `organization_domains`, com hostname globalmente único, associação à organização, tipo de domínio e estado de ativação. O resolvedor atende somente hosts ativos e vincula o host ao slug usado na rota. O cadastro, a verificação DNS e a ativação operacional pertencem às fases seguintes, conforme [ADR-011](decisions/ADR-011-organization-domains.md).

As verificações semânticas do spike continuam separadas. As tabelas da fila são administradas por pg-boss. Identidade usa o pool da API com transações e search_path local. RLS continua experimental conforme ADR-002.

## Implementado na Fase 3 — estrutura operacional

A migration `20261127014000_operational_structure` acrescenta ao schema `arena_identity` as nove entidades `customers`, `sports`, `venues`, `venue_units`, `venue_unit_links`, `venue_sports`, `operating_hours`, `calendar_exceptions` e `pricing_rules`. O arquivo `identity.prisma` espelha as colunas e relações para detectar drift; CHECKs, índices de expressão, `UNIQUE NULLS NOT DISTINCT` e triggers continuam definidos pelo SQL manual e inspecionados por `db:check`.

`venues` são ofertáveis e `venue_units` são recursos físicos elementares. O service cria uma unidade exclusiva ao cadastrar venue simples. Links compartilham unidade somente dentro da organização; FKs compostas impedem cruzamento de arenas. Triggers diferidos exigem ao menos uma unidade ativa em venue ativo ao confirmar a transação. Arquivar uma unidade usada por venue ativo falha. Arquivar venue mantém seus links históricos. Reserva, bloqueio e alteração de composição adquirem o lock do venue na mesma ordem após o lock da organização; a alteração estrutural recusa troca que afete ocupação futura.

Clientes possuem identidade interna, nome e contato opcional (telefone E.164 ou e-mail normalizado), sem login de cliente. Arquivamento preserva a linha. Modalidades e venues têm nome único por organização sem distinguir caixa, inclusive após arquivamento; criar outro nome igual exige restauração ou escolha de outro nome. Espaços suportam várias modalidades.

Cada turno semanal armazena dia local, hora de abertura/fechamento e marca 24 horas. Fechamento anterior à abertura atravessa a meia-noite. O service valida a semana inteira incluindo colisões com o dia seguinte e a virada domingo/segunda. Exceções usam data civil, escopo opcional de venue, `CLOSED` ou `SPECIAL_HOURS`, e unicidade com `NULLS NOT DISTINCT` para uma exceção global por data.

Regras de preço usam minutos locais `[start_minute,end_minute)` no mesmo dia, vigência inclusiva, preço por hora em centavos e arquivamento histórico. Faixa que atravessa meia-noite requer duas regras explícitas, uma por data/dia. Regras de mesmo escopo e nível não podem se sobrepor; a API trava a organização e o venue e revalida antes de gravar. O simulador usa a precedência do §6.6, calcula por minuto em inteiros e arredonda ao centavo uma única vez. Não cria transação comercial. Detalhes no [ADR-012](decisions/ADR-012-phase3-operational-model.md).

O catálogo de capabilities foi expandido sem conceder capacidades novas a cargos já persistidos. Templates novos só afetam organizações provisionadas após a migration. Domínios personalizados podem ser solicitados como `pending`; não há verificação DNS, TLS ou ativação.

## Implementação da Fase 4 — agenda definitiva

A migration `20261127015000_booking_engine` cria em `arena_identity`: `reservations`, `reservation_history`, `venue_blocks`, `schedule_occupancies`, `recurrence_contracts`, `recurrences`, `recurrence_rules`, `recurrence_exceptions`, `reservation_commercial_outcomes`, `reservation_payment_confirmations` e `idempotency_keys`. `identity.prisma` espelha o modelo; `check-schema.mjs` verifica semanticamente as garantias que Prisma não representa.

Cada reserva e bloqueio cria uma ocupação por unidade elementar. `period` é `tstzrange` gerado `[start_at,end_at)`; `schedule_no_overlap_final` exclui sobreposição ativa por `(organization_id,unit_id)`. FKs compostas mantêm origem, cliente, venue, modalidade, contrato e unidade na mesma arena. O serviço adquire `organizations FOR SHARE` e depois `venues FOR UPDATE` em ID crescente; a Fase 3 adquire organização `FOR UPDATE` antes do venue, então mudanças estruturais esperam a reserva e recusam alteração incompatível com ocupação futura. A agenda lê intervalos locais da organização, exceções e snapshots de preço; disponibilidade é fotografia e a escrita repete a validação sob lock.

Versões recorrentes são exclusivas por organização, contrato e vigência via GiST `daterange`; `recurrence_rules` guarda um dia/horário por regra. O worker `pg-boss` materializa até dez semanas, com transação por ocorrência, unicidade `(recurrence_id,occurrence_date)` e exceção de conflito persistida separadamente. `idempotency_keys` é definitivo e distinto da prova em `occupancy_spike`, guardando resposta na transação da operação. `reservation_payment_confirmations` guarda apenas referência de evidência previamente validada; financeiro definitivo continua na Fase 5. Ver [ADR-013](decisions/ADR-013-phase4-realtime.md), [ADR-014](decisions/ADR-014-phase4-commercial-policy.md) e [ADR-015](decisions/ADR-015-phase4-payment-boundary.md).

## Modelo comercial planejado

As Fases 3 e 4 implementaram clientes, venues, unidades e ocupações. Reservas duram 60 minutos por padrão e a grade padrão é de 15 minutos; o período ocupado é contínuo e semiaberto. A política V1 de cancelamento e no-show está definida no ADR-014. Exceções comerciais, feriados e reposições permanecem pendentes.

A Fase 5 acrescenta competências e cobranças, reutilizando os contratos da Fase 4 e o cálculo proporcional já definido para o primeiro mês. Atraso gera alerta e preserva reservas. Cobranças, pagamentos, estornos e alocações preservam histórico e cliente. A primeira versão comercial exige Pix confirmado automaticamente para a arena beneficiária. Ver [plano Mercado Pago](MERCADO_PAGO.md) e [matriz de impacto](decisions/ADR-010-product-and-access.md).

### Constraints e integridade candidatas

As garantias de agenda dos itens 2, 3, 4 e 8 já foram implementadas nas migrations das Fases 3 e 4; os demais itens financeiros continuam previstos para a Fase 5:

1. FKs compostas com `organization_id` em referências tenant; alocações carregam `customer_id` nas FKs triplas a `payments` e `charges`.
2. `schedule_occupancies`: `CHECK (end_at > start_at)`, origem exatamente uma entre reservation/block, range `[)` gerado, FK tenant para unidade/origem e `EXCLUDE USING gist (unit_id WITH =, period WITH &&) WHERE active`.
3. Exceções de calendário: unicidade `(organization_id, venue_id, date)` com `NULLS NOT DISTINCT` em PostgreSQL 15+, ou índices parciais equivalentes se compatibilidade exigir.
4. Versões recorrentes do mesmo contrato não sobrepõem vigência: `EXCLUDE` em `organization_id`, `contract_id` e `daterange`; rever vigência aberta e domínio de datas no DDL.
5. Cobranças de reserva e mensalidade usam índices únicos parciais somente para cobranças não anuladas. `replaces_charge_id` aponta para mesma organização e cliente; service valida tipo/vínculo e ciclos.
6. Unicidade lógica mensal inclui anuladas no job de geração, embora o índice parcial só impeça duplicação de cobrança ativa. Recriação é ação administrativa explícita.
7. Views de saldo somam alocações e devoluções separadamente. `SELECT ... FOR UPDATE` em pagamento e cobrança serializa alterações; checar somas e concorrência por teste real.
8. Concorrência entre reserva, bloqueio, alteração de composição de unidades e preço usa o mesmo lock de venue; múltiplos venues são travados em ordem crescente de ID.
9. Regras de preço precisam de uma representação normalizada de escopo/faixa temporal e garantia contra sobreposição concorrente. Recomendação: lock de venue em transação compartilhado por todos os escritores e validação após lock; avaliar constraint de exclusão SQL por nível quando o esquema de intervalos estiver normalizado.
