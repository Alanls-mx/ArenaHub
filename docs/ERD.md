# ERD candidato do MVP — para aprovação do fundador

**Estado:** identidade implementada; domínios comerciais planejados. Fonte de requisitos: `ARENAHUB_MASTER_V3.2.md` §§4–7. Decisão estratégica: [ADR-009](decisions/ADR-009-founder-led-development.md). Premissas comerciais não foram validadas por entrevistas.

`organization_id` está indicado nas entidades tenant, mesmo quando omitido dos relacionamentos visuais para legibilidade. FKs entre entidades tenant devem incluir `organization_id`; os diagramas não substituem o contrato de constraints em [DATABASE.md](DATABASE.md). `users` é global; `memberships` associa a pessoa às arenas. `arena_jobs` é schema administrado por pg-boss e omitido.

## Identidade e acesso implementados em arena_identity

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : autentica
    USERS ||--o{ PASSWORD_RESETS : recupera
    USERS ||--o{ MEMBERSHIPS : participa
    ORGANIZATIONS ||--|{ MEMBERSHIPS : vincula
    ORGANIZATIONS ||--o{ ROLES : define
    MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : recebe
    ROLES ||--o{ MEMBERSHIP_ROLES : atribui
    ROLES ||--o{ ROLE_PERMISSIONS : concede
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : cataloga
    ORGANIZATIONS ||--o| ORGANIZATION_THEMES : apresenta
    MEMBERSHIPS ||--o{ INVITES : convida
    USERS ||--o{ AUDIT_LOGS : atua
    ORGANIZATIONS o|--o{ AUDIT_LOGS : contextualiza
```

A chave da membership é (organization_id, user_id). is_owner é um atributo protegido. As duas pontas das atribuições compartilham organization_id. Cada organização operacional é provisionada com um Owner ativo. Instâncias de cargo têm nome único por organização, sem distinguir caixa.

Os diagramas seguintes são planejamento das fases 3 a 5. Pix acrescentará conta vinculada, intenção, tentativa, evento, reembolso e conciliação por organização. A reserva referencia uma versão da política central de cancelamento.

## Configuração da arena e clientes

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ SPORTS : owns
    ORGANIZATIONS ||--o{ VENUES : sells
    ORGANIZATIONS ||--o{ VENUE_UNITS : owns
    VENUES ||--o{ VENUE_UNIT_LINKS : composes
    VENUE_UNITS ||--o{ VENUE_UNIT_LINKS : assigned
    VENUES ||--o{ VENUE_SPORTS : supports
    SPORTS ||--o{ VENUE_SPORTS : enabled
    VENUES ||--o{ OPERATING_HOURS : opens
    VENUES o|--o{ CALENDAR_EXCEPTIONS : overrides
    VENUES ||--o{ VENUE_BLOCKS : blocks
    VENUES ||--o{ PRICING_RULES : prices
    SPORTS o|--o{ PRICING_RULES : filters
    ORGANIZATIONS ||--o{ CUSTOMERS : serves
    USERS o|--o{ CUSTOMERS : optional_login
    CUSTOMERS ||--o{ CUSTOMER_NOTES : notes
    USERS ||--o{ CUSTOMER_NOTES : authors

    SPORTS {
        uuid id PK
        uuid organization_id FK
        text name
        timestamptz archived_at
    }
    VENUES {
        uuid id PK
        uuid organization_id FK
        text name
        int slot_minutes
        int min_minutes
        int max_minutes
        int buffer_minutes
        bigint default_price_per_hour_cents
        timestamptz archived_at
    }
    VENUE_UNITS {
        uuid id PK
        uuid organization_id FK
        text name
        timestamptz archived_at
    }
    VENUE_UNIT_LINKS {
        uuid organization_id FK
        uuid venue_id FK
        uuid unit_id FK
    }
    VENUE_SPORTS {
        uuid organization_id FK
        uuid venue_id FK
        uuid sport_id FK
    }
    OPERATING_HOURS {
        uuid id PK
        uuid organization_id FK
        uuid venue_id FK
        int weekday
        time open_time
        time close_time
        boolean spans_full_day
    }
    CALENDAR_EXCEPTIONS {
        uuid id PK
        uuid organization_id FK
        uuid venue_id FK
        date date
        text kind
        time open_time
        time close_time
    }
    VENUE_BLOCKS {
        uuid id PK
        uuid organization_id FK
        uuid venue_id FK
        timestamptz start_at
        timestamptz end_at
        text reason
        timestamptz cancelled_at
    }
    PRICING_RULES {
        uuid id PK
        uuid organization_id FK
        uuid venue_id FK
        uuid sport_id FK
        date specific_date
        int weekday
        time start_time
        time end_time
        bigint price_per_hour_cents
        date valid_from
        date valid_until
    }
    CUSTOMERS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        text name
        text phone_e164
        citext email
        timestamptz archived_at
        timestamptz anonymized_at
    }
    CUSTOMER_NOTES {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        uuid author_user_id FK
        text body
        timestamptz created_at
    }
```

### Questões estruturais deste grupo

- Venue comercializável permanece separado de unidade física; confirmar que espaço divisível pertence ao MVP mesmo que a UI simples oculte unidade única.
- `venue_id NULL` em exceção significa data fechada/especial para a arena inteira; unicidade exige `NULLS NOT DISTINCT` ou índices parciais.
- Definir se `operating_hours` representa cada turno como linha e como horários que atravessam meia-noite são representados sem ambiguidade.
- Regras de preço precisam escopo/nível normalizado, intervalos locais e vigência; escrita trava o venue e revalida após lock. Confirmar defaults antes de apresentar como regra padrão.
- Telefones duplicados não são proibidos; dados pessoais de notas devem ser mínimos e sujeitos a controle/retenção.

## Agenda, recorrência e financeiro

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ RECURRENCE_CONTRACTS : scopes
    CUSTOMERS ||--o{ RECURRENCE_CONTRACTS : contracts
    RECURRENCE_CONTRACTS ||--o{ RECURRENCES : versions
    RECURRENCES o|--o{ RESERVATIONS : generates
    VENUES ||--o{ RESERVATIONS : hosts
    SPORTS o|--o{ RESERVATIONS : classifies
    CUSTOMERS ||--o{ RESERVATIONS : books
    RESERVATIONS ||--o{ RESERVATION_HISTORY : changes
    RESERVATIONS ||--o{ SCHEDULE_OCCUPANCIES : occupies
    VENUE_UNITS ||--o{ SCHEDULE_OCCUPANCIES : reserved
    VENUE_BLOCKS o|--o{ SCHEDULE_OCCUPANCIES : blocks
    RECURRENCES ||--o{ RECURRENCE_EXCEPTIONS : exceptions
    RESERVATIONS o|--o{ RECURRENCE_EXCEPTIONS : resolves
    CUSTOMERS ||--o{ CHARGES : owes
    RESERVATIONS o|--o{ CHARGES : billed
    RECURRENCE_CONTRACTS o|--o{ CHARGES : monthly
    CHARGES o|--o{ CHARGES : replaces
    CUSTOMERS ||--o{ PAYMENTS : pays
    PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : allocated
    CHARGES ||--o{ PAYMENT_ALLOCATIONS : settled_by
    PAYMENTS ||--o{ PAYMENT_REFUNDS : refunded

    RECURRENCE_CONTRACTS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        text billing_mode
        text status
        timestamptz ended_at
    }
    RECURRENCES {
        uuid id PK
        uuid organization_id FK
        uuid contract_id FK
        uuid venue_id FK
        int weekday
        time start_time
        int duration_minutes
        date starts_on
        date ends_on
        bigint price_cents
        bigint monthly_amount_cents
        date effective_from
        date generated_until
    }
    RESERVATIONS {
        uuid id PK
        uuid organization_id FK
        uuid venue_id FK
        uuid sport_id FK
        uuid customer_id FK
        uuid recurrence_id FK
        date occurrence_date
        timestamptz start_at
        timestamptz end_at
        text status
        bigint price_cents
        jsonb price_breakdown
        int version
    }
    RESERVATION_HISTORY {
        uuid id PK
        uuid organization_id FK
        uuid reservation_id FK
        uuid actor_user_id FK
        text action
        jsonb changes
        timestamptz created_at
    }
    RECURRENCE_EXCEPTIONS {
        uuid id PK
        uuid organization_id FK
        uuid recurrence_id FK
        date occurrence_date
        text kind
        uuid reservation_id FK
        text reason
        timestamptz resolved_at
    }
    SCHEDULE_OCCUPANCIES {
        uuid id PK
        uuid organization_id FK
        uuid unit_id FK
        uuid reservation_id FK
        uuid block_id FK
        timestamptz start_at
        timestamptz end_at
        boolean active
    }
    CHARGES {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        uuid reservation_id FK
        uuid contract_id FK
        uuid replaces_charge_id FK
        text kind
        date period_month
        bigint amount_cents
        date due_date
        timestamptz voided_at
    }
    PAYMENTS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        bigint amount_cents
        text method
        timestamptz received_at
        timestamptz reversed_at
    }
    PAYMENT_ALLOCATIONS {
        uuid id PK
        uuid organization_id FK
        uuid customer_id FK
        uuid payment_id FK
        uuid charge_id FK
        bigint amount_cents
        timestamptz reversed_at
    }
    PAYMENT_REFUNDS {
        uuid id PK
        uuid organization_id FK
        uuid payment_id FK
        bigint amount_cents
        timestamptz refunded_at
        text reason
    }
```

### Questões estruturais deste grupo

- Contrato de mensalista é estável; versões não podem sobrepor vigência. Ocorrências, exceções e reservas devem ser criadas/resolvidas em transações idempotentes.
- `schedule_occupancies` exige uma única origem (reserva ou bloqueio), range `[start,end)`, e exclusion constraint por unidade física. Reserva, bloqueio, mudança de unidades e preços compartilham locking de venue.
- Cobranças anuladas permanecem; índice parcial garante só uma ativa por reserva/tipo e contrato/mês. O job mensal também consulta cobranças anuladas para não recriá-las silenciosamente.
- Alocações ligam payment e charge do mesmo cliente e organização por FKs triplas; travar ambos antes de validar saldo. `charge_balances` e `payment_balances` são views candidatas com agregações separadas.
- Preservar snapshots de preço, competência e autoria em eventos financeiros; valores em inteiro/centavos.

## Fora do modelo de domínio

- Tabelas internas de `pg-boss` são geridas pela dependência no schema configurado e não fazem parte das migrations de domínio Prisma.
- `outbox_events`, página pública e login de cliente final ficam fora do MVP.
- O diagrama não é DDL nem autorização para construir: leia [DATABASE.md](DATABASE.md) para regras de integridade e aprovação do fundador.
