BEGIN;
CREATE SCHEMA arena_identity;
SET LOCAL search_path TO arena_identity;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL CHECK(email=lower(trim(email))), name text NOT NULL, password_hash text NOT NULL,
 disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 organization_id uuid NOT NULL REFERENCES organizations, user_id uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')), is_owner boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,user_id), CHECK(NOT is_owner OR status='active')
);
CREATE TABLE permissions(code text PRIMARY KEY);
CREATE TABLE roles (
 organization_id uuid NOT NULL REFERENCES organizations, id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, description text NOT NULL DEFAULT '',
 PRIMARY KEY(organization_id,id)
);
CREATE UNIQUE INDEX role_name ON roles(organization_id,lower(name));
CREATE TABLE role_permissions (
 organization_id uuid NOT NULL, role_id uuid NOT NULL, code text NOT NULL REFERENCES permissions,
 PRIMARY KEY(organization_id,role_id,code), FOREIGN KEY(organization_id,role_id) REFERENCES roles ON DELETE CASCADE
);
CREATE TABLE membership_roles (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, role_id uuid NOT NULL,
 PRIMARY KEY(organization_id,user_id,role_id), FOREIGN KEY(organization_id,user_id) REFERENCES memberships, FOREIGN KEY(organization_id,role_id) REFERENCES roles ON DELETE CASCADE
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users, token_hash text UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE password_resets (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users, expires_at timestamptz NOT NULL);
CREATE TABLE invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations,email text NOT NULL,token_hash text UNIQUE NOT NULL,
 invited_by uuid NOT NULL,expires_at timestamptz NOT NULL,closed_at timestamptz, FOREIGN KEY(organization_id,invited_by) REFERENCES memberships);
CREATE UNIQUE INDEX pending_email ON invites(organization_id,email) WHERE closed_at IS NULL;
CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users, organization_id uuid REFERENCES organizations, action text NOT NULL, entity text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO permissions(code) VALUES ('members.read'),('members.manage'),('roles.manage'),('roles.assign'),('charges.read'),('payments.record'),('pix.create'),('finance.read'),('cashflow.read'),('revenue.read'),('expenses.read'),('reports.export'),('payments.reverse'),('refunds.request'),('integrations.manage');
COMMIT;
