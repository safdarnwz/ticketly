-- =============================================================================
-- Application database role provisioning  (run once per environment, as a
-- superuser, BEFORE the app connects — e.g. from your deploy/bootstrap step).
--
-- CRITICAL SECURITY REQUIREMENT
-- ─────────────────────────────
-- The application MUST connect as this role, NOT as a superuser and NOT as any
-- role with the BYPASSRLS attribute. PostgreSQL Row-Level Security is silently
-- bypassed for superusers and BYPASSRLS roles — so connecting the app as
-- `postgres` would DISABLE every tenant-isolation policy in the platform.
--
-- This role is deliberately NOSUPERUSER NOBYPASSRLS. `FORCE ROW LEVEL SECURITY`
-- on each table (see migration 0002) then makes the policies apply even though
-- this role owns nothing.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gds_app') THEN
    CREATE ROLE gds_app LOGIN
      PASSWORD 'change-me-in-production'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      CONNECTION LIMIT 200;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO gds_app;

-- DML only — no DDL. Migrations run as the owner/superuser, never as the app.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gds_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gds_app;

-- Future tables created by later migrations inherit these grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gds_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gds_app;

-- The GUCs the app sets per connection must be settable by this role.
-- (app.tenant_id / app.bypass_rls are custom, unprivileged settings — no grant
--  needed — but documented here for clarity.)
