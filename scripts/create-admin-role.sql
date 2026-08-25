-- Creates the least-privilege PostgreSQL role used by the management portal.
--
-- Run once as a superuser (or the database owner):
--   psql "$DATABASE_URL" -f scripts/create-admin-role.sql
--
-- The portal role may read and mutate operational data, but audit and sign-in
-- event tables are append-only: SELECT and INSERT only, so even a full portal
-- compromise cannot rewrite history. Run with :password placeholders replaced,
-- for example via:  psql -v password="..." -f scripts/create-admin-role.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'basis_admin') THEN
    CREATE ROLE basis_admin LOGIN PASSWORD :'admin_password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO basis_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users,
  user_permissions,
  oidc_clients,
  resource_servers,
  auth_sessions,
  authorization_consents,
  authorization_requests,
  client_secrets,
  local_credentials,
  admin_sessions,
  app_assets,
  settings
TO basis_admin;

GRANT UPDATE, DELETE ON refresh_tokens TO basis_admin;
-- Artifact cleanup for the portal hygiene sweep (read + delete).
GRANT SELECT, DELETE ON auth_sessions, authorization_requests, authorization_codes, upstream_auth_requests, refresh_tokens TO basis_admin;
GRANT SELECT, INSERT ON refresh_tokens TO basis_admin;

-- Append-only history tables.
GRANT SELECT, INSERT ON audit_events TO basis_admin;
GRANT SELECT, INSERT ON auth_events TO basis_admin;

-- Sequences backing serial columns.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO basis_admin;


