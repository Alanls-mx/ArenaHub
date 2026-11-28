BEGIN;
SET LOCAL search_path TO arena_identity,pg_catalog;

INSERT INTO permissions(code) VALUES
 ('customers.read'),('customers.manage'),('customers.archive'),('sports.read'),('sports.manage'),
 ('venues.read'),('venues.manage'),('units.manage'),('hours.read'),('hours.manage'),
 ('pricing.read'),('pricing.manage'),('pricing.simulate'),('domains.manage');

CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 phone_e164 text CHECK(phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
 email text CHECK(email IS NULL OR email=lower(trim(email))),
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE INDEX customers_lookup ON customers(organization_id,archived_at,lower(name),id);
CREATE INDEX customers_phone ON customers(organization_id,phone_e164);

CREATE TABLE sports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80), archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX sports_name ON sports(organization_id,lower(name));

CREATE TABLE venues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 slot_minutes integer CHECK(slot_minutes IS NULL OR slot_minutes > 0),
 min_minutes integer CHECK(min_minutes IS NULL OR min_minutes > 0),
 max_minutes integer CHECK(max_minutes IS NULL OR max_minutes > 0),
 buffer_minutes integer CHECK(buffer_minutes IS NULL OR buffer_minutes >= 0),
 default_price_per_hour_cents bigint CHECK(default_price_per_hour_cents IS NULL OR default_price_per_hour_cents BETWEEN 0 AND 9007199254740991),
 color text, sort_order integer NOT NULL DEFAULT 0, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(min_minutes IS NULL OR max_minutes IS NULL OR min_minutes<=max_minutes), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX venues_name ON venues(organization_id,lower(name));
CREATE INDEX venues_order ON venues(organization_id,archived_at,sort_order,name);

CREATE TABLE venue_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120), archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX venue_units_name ON venue_units(organization_id,lower(name));

CREATE TABLE venue_unit_links (
 organization_id uuid NOT NULL, venue_id uuid NOT NULL, unit_id uuid NOT NULL,
 PRIMARY KEY(organization_id,venue_id,unit_id),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,unit_id) REFERENCES venue_units(organization_id,id)
);
CREATE INDEX venue_unit_links_unit ON venue_unit_links(organization_id,unit_id,venue_id);
CREATE TABLE venue_sports (
 organization_id uuid NOT NULL, venue_id uuid NOT NULL, sport_id uuid NOT NULL,
 PRIMARY KEY(organization_id,venue_id,sport_id),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,sport_id) REFERENCES sports(organization_id,id)
);
CREATE INDEX venue_sports_sport ON venue_sports(organization_id,sport_id);

CREATE TABLE operating_hours (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, venue_id uuid NOT NULL,
 weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 open_time time NOT NULL, close_time time NOT NULL, spans_full_day boolean NOT NULL DEFAULT false,
 CHECK((open_time=close_time)=spans_full_day),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id), UNIQUE(organization_id,id)
);
CREATE INDEX operating_hours_venue_day ON operating_hours(organization_id,venue_id,weekday);

CREATE TABLE calendar_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 venue_id uuid, date date NOT NULL, kind text NOT NULL CHECK(kind IN ('CLOSED','SPECIAL_HOURS')),
 open_time time, close_time time, description text NOT NULL DEFAULT '',
 CHECK((kind='CLOSED' AND open_time IS NULL AND close_time IS NULL) OR
       (kind='SPECIAL_HOURS' AND open_time IS NOT NULL AND close_time IS NOT NULL)),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 UNIQUE NULLS NOT DISTINCT(organization_id,venue_id,date), UNIQUE(organization_id,id)
);

CREATE TABLE pricing_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, venue_id uuid NOT NULL,
 sport_id uuid, specific_date date, weekday smallint CHECK(weekday BETWEEN 0 AND 6),
 start_minute smallint NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute smallint NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
 price_per_hour_cents bigint NOT NULL CHECK(price_per_hour_cents BETWEEN 0 AND 9007199254740991),
 valid_from date, valid_until date, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(start_minute<end_minute),
 CHECK((specific_date IS NOT NULL AND weekday IS NULL AND valid_from IS NULL AND valid_until IS NULL) OR
       (specific_date IS NULL AND weekday IS NOT NULL)),
 CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_from<=valid_until),
 FOREIGN KEY(organization_id,venue_id) REFERENCES venues(organization_id,id),
 FOREIGN KEY(organization_id,sport_id) REFERENCES sports(organization_id,id),
 UNIQUE(organization_id,id)
);
CREATE INDEX pricing_rules_lookup ON pricing_rules(organization_id,venue_id,archived_at,specific_date,weekday);

CREATE FUNCTION ensure_venue_composition() RETURNS trigger LANGUAGE plpgsql SET search_path = arena_identity,pg_catalog AS $$
DECLARE target_org uuid; target_venue uuid;
BEGIN
 IF TG_TABLE_NAME='venues' THEN
   target_org:=NEW.organization_id; target_venue:=NEW.id;
 ELSIF TG_TABLE_NAME='venue_units' THEN
   IF NEW.archived_at IS NOT NULL AND EXISTS (
     SELECT 1 FROM venue_unit_links l JOIN venues v ON v.organization_id=l.organization_id AND v.id=l.venue_id
     WHERE l.organization_id=NEW.organization_id AND l.unit_id=NEW.id AND v.archived_at IS NULL
   ) THEN RAISE EXCEPTION 'active venue references archived unit' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 ELSE
   IF TG_OP='UPDATE' AND (OLD.organization_id,OLD.venue_id) IS DISTINCT FROM (NEW.organization_id,NEW.venue_id) AND
      EXISTS(SELECT 1 FROM venues WHERE organization_id=OLD.organization_id AND id=OLD.venue_id AND archived_at IS NULL) AND
      NOT EXISTS(SELECT 1 FROM venue_unit_links WHERE organization_id=OLD.organization_id AND venue_id=OLD.venue_id)
   THEN RAISE EXCEPTION 'active venue requires active physical units' USING ERRCODE='23514'; END IF;
   target_org:=COALESCE(NEW.organization_id,OLD.organization_id);
   target_venue:=COALESCE(NEW.venue_id,OLD.venue_id);
 END IF;
 IF EXISTS(SELECT 1 FROM venues WHERE organization_id=target_org AND id=target_venue AND archived_at IS NULL) AND
    (NOT EXISTS(SELECT 1 FROM venue_unit_links WHERE organization_id=target_org AND venue_id=target_venue) OR
     EXISTS(SELECT 1 FROM venue_unit_links l JOIN venue_units u ON u.organization_id=l.organization_id AND u.id=l.unit_id
            WHERE l.organization_id=target_org AND l.venue_id=target_venue AND u.archived_at IS NOT NULL))
 THEN RAISE EXCEPTION 'active venue requires active physical units' USING ERRCODE='23514'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE CONSTRAINT TRIGGER venue_composition_guard AFTER INSERT OR UPDATE ON venues
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ensure_venue_composition();
CREATE CONSTRAINT TRIGGER venue_links_guard AFTER INSERT OR UPDATE OR DELETE ON venue_unit_links
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ensure_venue_composition();
CREATE CONSTRAINT TRIGGER venue_unit_archive_guard AFTER UPDATE ON venue_units
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ensure_venue_composition();

COMMIT;
