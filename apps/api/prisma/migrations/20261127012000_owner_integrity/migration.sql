BEGIN;
-- Conferir no commit permite criar organização e primeiro vínculo na mesma transação.
CREATE FUNCTION arena_identity.require_owner(org uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, arena_identity AS $$
BEGIN
  PERFORM id FROM organizations WHERE id = org AND active FOR UPDATE;
  IF FOUND AND NOT EXISTS (
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = org AND m.is_owner AND m.status = 'active' AND u.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Operational organization requires an active owner' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION arena_identity.check_owner_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, arena_identity AS $$
DECLARE org uuid;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    PERFORM require_owner(NEW.id);
  ELSIF TG_TABLE_NAME = 'users' THEN
    FOR org IN SELECT organization_id FROM memberships WHERE user_id = NEW.id AND is_owner ORDER BY organization_id LOOP
      PERFORM require_owner(org);
    END LOOP;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM require_owner(OLD.organization_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM require_owner(NEW.organization_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER organization_owner AFTER INSERT OR UPDATE OF active ON arena_identity.organizations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION arena_identity.check_owner_change();
CREATE CONSTRAINT TRIGGER membership_owner AFTER INSERT OR UPDATE OR DELETE ON arena_identity.memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION arena_identity.check_owner_change();
CREATE CONSTRAINT TRIGGER account_owner AFTER UPDATE OF disabled_at ON arena_identity.users
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.disabled_at IS NOT NULL) EXECUTE FUNCTION arena_identity.check_owner_change();

CREATE FUNCTION arena_identity.preserve_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON arena_identity.audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION arena_identity.preserve_audit();
COMMIT;
