BEGIN;
ALTER TABLE arena_identity.organizations ADD CONSTRAINT organizations_slug_safe
  CHECK (length(slug) <= 63 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND slug NOT IN ('api', 'app', 'auth', 'admin', 'www', 'mail', 'status', 'support'));
CREATE TABLE arena_identity.organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES arena_identity.organizations(id),
  hostname text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('platform', 'custom')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CHECK (hostname = lower(hostname) AND hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  CHECK ((status = 'active') = (activated_at IS NOT NULL))
);
CREATE INDEX organization_domains_org ON arena_identity.organization_domains(organization_id);
COMMIT;
