BEGIN;
SET LOCAL search_path TO arena_identity;
ALTER TABLE organizations ADD COLUMN timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
CREATE TABLE organization_themes (
 organization_id uuid PRIMARY KEY REFERENCES organizations,
 theme jsonb NOT NULL, previous_theme jsonb, version integer NOT NULL DEFAULT 1,
 published_at timestamptz NOT NULL DEFAULT now(), published_by uuid NOT NULL,
 FOREIGN KEY(organization_id,published_by) REFERENCES memberships(organization_id,user_id)
);
COMMIT;
