BEGIN;
SET LOCAL search_path TO arena_identity,pg_catalog;
CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO permissions(code) VALUES
 ('reservations.read'),('reservations.create'),('reservations.manage'),
 ('schedule_blocks.manage'),('recurrences.read'),('recurrences.manage'),
 ('reservations.confirm'),('reservations.reschedule'),('reservations.cancel'),
 ('reservations.no_show'),('reservations.complete'),('commercial_policy.override');

CREATE TABLE recurrence_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 customer_id uuid NOT NULL, billing_mode text NOT NULL CHECK(billing_mode IN ('MONTHLY','PER_OCCURRENCE')),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED')),
 ended_at timestamptz, ended_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,customer_id) REFERENCES customers(organization_id,id),
 FOREIGN KEY(organization_id,ended_by) REFERENCES memberships(organization_id,user_id),
 CHECK((status='ACTIVE' AND ended_at IS NULL AND ended_by IS NULL) OR
       (status='ENDED' AND ended_at IS NOT NULL AND ended_by IS NOT NULL)),
 UNIQUE(organization_id,id), UNIQUE(organization_id,customer_id,id)
);
CREATE INDEX recurrence_contracts_customer ON recurrence_contracts(organization_id,customer_id,status);

CREATE TABLE recurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 contract_id uuid NOT NULL, venue_id uuid NOT NULL, sport_id uuid,
 weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6), start_time time NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
 starts_on date NOT NULL, ends_on date, effective_from date NOT NULL,
 price_cents bigint NOT NULL CHECK(price_cents BETWEEN 0 AND 9007199254740991),
 monthly_amount_cents bigint CHECK(monthly_amount_cents BETWEEN 0 AND 9007199254740991),
 previous_recurrence_id uuid, generated_until date, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on IS NULL OR ends_on>=starts_on),
 CHECK(effective_from>=starts_on),
 FOREIGN KEY(organization_id,contract_id) REFERENCES recurrence_contracts(organization_id,id),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,sport_id) REFERENCES sports(organization_id,id),
 FOREIGN KEY(organization_id,previous_recurrence_id) REFERENCES recurrences(organization_id,id),
 UNIQUE(organization_id,id),
 CONSTRAINT recurrence_versions_no_overlap EXCLUDE USING gist
   (organization_id WITH =, contract_id WITH =,
    daterange(starts_on,COALESCE(ends_on,'infinity'::date),'[]') WITH &&)
);
CREATE INDEX recurrences_generation ON recurrences(organization_id,generated_until,starts_on);

CREATE TABLE recurrence_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 recurrence_id uuid NOT NULL, weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_time time NOT NULL, duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),
 FOREIGN KEY(organization_id,recurrence_id) REFERENCES recurrences(organization_id,id),
 UNIQUE(organization_id,id), UNIQUE(organization_id,recurrence_id,weekday)
);

CREATE TABLE reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 venue_id uuid NOT NULL, sport_id uuid, customer_id uuid NOT NULL, recurrence_id uuid,
 occurrence_date date, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW')),
 source text NOT NULL CHECK(source IN ('ADMIN','IN_PERSON','RECURRENCE')),
 price_cents bigint NOT NULL CHECK(price_cents BETWEEN 0 AND 9007199254740991),
 price_source text NOT NULL CHECK(price_source IN ('RULE','DEFAULT','RECURRENCE','MANUAL')),
 pricing_rule_id uuid, price_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
 policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version>0), notes text NOT NULL DEFAULT '',
 created_by uuid, confirmed_at timestamptz, cancelled_at timestamptz,
 cancelled_by uuid, cancellation_reason text, no_show_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at>start_at), CHECK((recurrence_id IS NULL)=(occurrence_date IS NULL)),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,sport_id) REFERENCES sports(organization_id,id),
 FOREIGN KEY(organization_id,customer_id) REFERENCES customers(organization_id,id),
 FOREIGN KEY(organization_id,recurrence_id) REFERENCES recurrences(organization_id,id),
 FOREIGN KEY(organization_id,pricing_rule_id) REFERENCES pricing_rules(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES memberships(organization_id,user_id),
 UNIQUE(organization_id,id), UNIQUE(organization_id,customer_id,id),
 UNIQUE(recurrence_id,occurrence_date)
);
CREATE INDEX reservations_agenda ON reservations(organization_id,start_at,venue_id);
CREATE INDEX reservations_customer ON reservations(organization_id,customer_id,start_at DESC);

CREATE TABLE venue_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 venue_id uuid NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 created_by uuid NOT NULL, cancelled_at timestamptz, cancelled_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at>start_at), CHECK((cancelled_at IS NULL)=(cancelled_by IS NULL)),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES memberships(organization_id,user_id),
 UNIQUE(organization_id,id)
);
CREATE INDEX venue_blocks_agenda ON venue_blocks(organization_id,start_at,venue_id);

CREATE TABLE schedule_occupancies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 unit_id uuid NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 period tstzrange GENERATED ALWAYS AS (tstzrange(start_at,end_at,'[)')) STORED,
 reservation_id uuid, block_id uuid, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT schedule_occupancies_valid_interval CHECK(end_at>start_at),
 CONSTRAINT schedule_occupancies_one_origin CHECK(num_nonnulls(reservation_id,block_id)=1),
 FOREIGN KEY(organization_id,unit_id) REFERENCES venue_units(organization_id,id),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
 FOREIGN KEY(organization_id,block_id) REFERENCES venue_blocks(organization_id,id),
 UNIQUE(organization_id,id),
 CONSTRAINT schedule_no_overlap_final EXCLUDE USING gist
   (organization_id WITH =,unit_id WITH =,period WITH &&) WHERE(active)
);
CREATE INDEX schedule_occ_org_period_final ON schedule_occupancies USING gist(organization_id,period) WHERE active;
CREATE INDEX schedule_occ_reservation_final ON schedule_occupancies(organization_id,reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX schedule_occ_block_final ON schedule_occupancies(organization_id,block_id) WHERE block_id IS NOT NULL;

CREATE TABLE reservation_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 reservation_id uuid NOT NULL, action text NOT NULL, from_status text, to_status text,
 changes jsonb NOT NULL DEFAULT '{}'::jsonb, actor_user_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX reservation_history_record ON reservation_history(organization_id,reservation_id,created_at);

CREATE TABLE recurrence_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 recurrence_id uuid NOT NULL, occurrence_date date NOT NULL,
 kind text NOT NULL CHECK(kind IN ('SKIPPED','CONFLICT','MOVED')),
 reservation_id uuid, reason text NOT NULL DEFAULT '', resolved_at timestamptz, resolved_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,recurrence_id) REFERENCES recurrences(organization_id,id),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
 FOREIGN KEY(organization_id,resolved_by) REFERENCES memberships(organization_id,user_id),
 UNIQUE(organization_id,recurrence_id,occurrence_date)
);

CREATE TABLE reservation_commercial_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 reservation_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('CANCELLATION','NO_SHOW','RESCHEDULE')),
 policy_version integer NOT NULL CHECK(policy_version>0),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 9007199254740991),
 original_price_cents bigint CHECK(original_price_cents BETWEEN 0 AND 9007199254740991),
 policy_percent integer CHECK(policy_percent IN (0,50,100)),
 lead_seconds bigint,
 applied_exception boolean NOT NULL DEFAULT false,
 previous_price_cents bigint CHECK(previous_price_cents BETWEEN 0 AND 9007199254740991),
 CHECK(kind='RESCHEDULE' OR (original_price_cents IS NOT NULL AND policy_percent IS NOT NULL AND lead_seconds IS NOT NULL)),
 reason text, waived_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES reservations(organization_id,id),
 FOREIGN KEY(organization_id,waived_by) REFERENCES memberships(organization_id,user_id),
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX reservation_terminal_outcome ON reservation_commercial_outcomes
 (organization_id,reservation_id,kind) WHERE kind IN ('CANCELLATION','NO_SHOW');

CREATE TABLE idempotency_keys (
 organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL,
 key text NOT NULL CHECK(length(key) BETWEEN 16 AND 200), method text NOT NULL,
 route text NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
 response_status integer NOT NULL CHECK(response_status BETWEEN 200 AND 299),
 response_body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 PRIMARY KEY(organization_id,user_id,key),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),
 CONSTRAINT idempotency_keys_expiry CHECK(expires_at>created_at)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at);

-- This is an idempotent link to a validated future payment, not a payment ledger.
CREATE TABLE reservation_payment_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 reservation_id uuid NOT NULL, customer_id uuid NOT NULL,
 external_payment_ref text NOT NULL CHECK(length(external_payment_ref) BETWEEN 1 AND 200),
 approved_amount_cents bigint NOT NULL CHECK(approved_amount_cents BETWEEN 0 AND 9007199254740991),
 approved_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,customer_id,reservation_id)
   REFERENCES reservations(organization_id,customer_id,id),
 UNIQUE(organization_id,id), UNIQUE(organization_id,external_payment_ref),
 UNIQUE(organization_id,reservation_id,external_payment_ref)
);
CREATE INDEX reservation_payment_confirmations_reservation ON reservation_payment_confirmations(organization_id,reservation_id);

COMMIT;
