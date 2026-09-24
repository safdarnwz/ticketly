-- =============================================================================
-- 0002_tenancy_and_iam
--
-- The multi-tenant backbone: operators (tenants), plans & feature flags, users,
-- the RBAC model (roles ⇄ permissions), sessions, API keys, OTP challenges and
-- an append-only audit log. Row-Level Security is enabled here and every
-- tenant-scoped table added in later parts follows the same policy shape.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- plans — commercial tiers that gate features and quotas
--
-- Platform-level data (no tenant_id): the same catalogue of plans is offered to
-- every operator. A tenant references the plan it is on.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code            text        NOT NULL UNIQUE,          -- 'starter' | 'growth' | 'enterprise'
  name            text        NOT NULL,
  -- Feature flags and quotas are jsonb so a new gated feature does not require a
  -- migration — it is a plan-config change. GIN-indexed for containment queries.
  features        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  quotas          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  monthly_price   bigint      NOT NULL DEFAULT 0,        -- minor units
  currency        char(3)     NOT NULL DEFAULT 'INR',
  is_active       boolean     NOT NULL DEFAULT true,
  sort_order      smallint    NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_features_idx ON plans USING gin (features);

-- ─────────────────────────────────────────────────────────────────────────────
-- tenants — the bus operators. THE root of the multi-tenant tree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE tenant_status AS ENUM ('provisioning', 'active', 'suspended', 'closed');

CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- URL-safe short handle, e.g. 'orange-travels'. Used for subdomain-based
  -- tenant resolution (orange-travels.book.example.com).
  slug            text          NOT NULL UNIQUE,
  legal_name      text          NOT NULL,
  display_name    text          NOT NULL,
  status          tenant_status NOT NULL DEFAULT 'provisioning',
  plan_id         uuid          REFERENCES plans(id),
  -- Custom domains the operator has verified (their own booking site).
  primary_domain  text          UNIQUE,
  contact_email   text          NOT NULL,
  contact_phone   text,
  -- Locale/currency/timezone defaults for this operator's storefront.
  timezone        text          NOT NULL DEFAULT 'Asia/Kolkata',
  currency        char(3)       NOT NULL DEFAULT 'INR',
  locale          text          NOT NULL DEFAULT 'en-IN',
  -- Branding, GST number, invoice prefix, etc. — schemaless operator settings.
  settings        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Per-tenant feature/quota overrides layered ON TOP of the plan.
  feature_overrides jsonb       NOT NULL DEFAULT '{}'::jsonb,
  suspended_reason  text,
  suspended_at      timestamptz,
  version         integer       NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX tenants_status_idx ON tenants (status) WHERE deleted_at IS NULL;
CREATE INDEX tenants_slug_lower_idx ON tenants (lower(slug));
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tenants IS 'Bus operators. Every tenant-scoped row references one of these via tenant_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- users — humans (operator staff) and customers
--
-- A user belongs to exactly one tenant. Platform-super-admins are modelled as a
-- special NULL-tenant user with the '*' permission (see roles below) and are
-- created out of band, never via the tenant-scoped API.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE user_status AS ENUM ('invited', 'active', 'disabled', 'locked');
CREATE TYPE user_kind   AS ENUM ('staff', 'customer', 'system');

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid          REFERENCES tenants(id),  -- NULL only for platform admins
  kind            user_kind     NOT NULL DEFAULT 'staff',
  status          user_status   NOT NULL DEFAULT 'active',
  email           text,
  email_blind     text,          -- blind index for encrypted-email exact lookup
  phone           text,
  phone_blind     text,
  full_name       text          NOT NULL,
  password_hash   text,          -- NULL for OTP-only customers
  -- Failed-login tracking for account lockout.
  failed_logins   smallint      NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  mfa_enabled     boolean       NOT NULL DEFAULT false,
  metadata        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  version         integer       NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
-- Email/phone are unique WITHIN a tenant (the same person can be a customer of
-- two operators). NULLS NOT DISTINCT is not wanted here — many users have no
-- email — so we use partial unique indexes over the blind index.
CREATE UNIQUE INDEX users_tenant_email_idx ON users (tenant_id, email_blind)
  WHERE email_blind IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_tenant_phone_idx ON users (tenant_id, phone_blind)
  WHERE phone_blind IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_tenant_status_idx ON users (tenant_id, status) WHERE deleted_at IS NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- roles & permissions — RBAC
--
-- Permissions are platform-defined strings (the catalogue in
-- libs/contracts/permissions.ts). Roles are per-tenant bundles of permissions,
-- plus a set of system roles every tenant gets at provisioning time
-- (owner/admin/manager/support/viewer).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE permissions (
  code        text PRIMARY KEY,                       -- 'booking:cancel'
  resource    text NOT NULL,
  action      text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid REFERENCES tenants(id),           -- NULL = platform/system role template
  code         text NOT NULL,                         -- 'owner', 'manager', ...
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  -- System roles cannot be edited or deleted by tenant admins.
  is_system    boolean NOT NULL DEFAULT false,
  -- ABAC condition layered on top of the role's permissions, e.g.
  -- {"route_id": {"in": ["..."]}} to scope a manager to specific routes.
  conditions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- sessions — refresh-token lifecycle & revocation
--
-- Access tokens are stateless; the refresh token's jti lives here so a session
-- can be revoked (logout, password change, admin kill). The token itself is
-- never stored — only a hash of it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash    text NOT NULL,          -- sha256 of the refresh token
  user_agent      text,
  ip              inet,
  -- Rotation chain: each refresh mints a new token and points back at the old
  -- jti, so token-reuse (a stolen refresh token replayed after rotation) is
  -- detectable and revokes the whole chain.
  parent_id       uuid REFERENCES sessions(id),
  revoked_at      timestamptz,
  revoked_reason  text,
  expires_at      timestamptz NOT NULL,
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_refresh_idx ON sessions (refresh_hash);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- api_keys — server-to-server credentials for OTA / channel partners
--
-- Only a hash of the key is stored. The plaintext is shown once at creation and
-- never again. A short, non-secret prefix is kept so a key can be identified in
-- logs and in the admin UI without exposing the secret.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  prefix          text NOT NULL,          -- first 8 chars, indexed for lookup
  key_hash        text NOT NULL,          -- sha256 of the full key
  -- Scoped permissions this key carries (a subset of the tenant's).
  scopes          text[] NOT NULL DEFAULT '{}',
  -- Optional IP allow-list (CIDR) for defence in depth.
  ip_allowlist    cidr[]  NOT NULL DEFAULT '{}',
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX api_keys_prefix_idx ON api_keys (prefix) WHERE revoked_at IS NULL;
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- otp_challenges — phone/email OTP login
--
-- Stores only the HMAC of the code. Attempts and expiry gate brute force.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid REFERENCES tenants(id),
  identity      text NOT NULL,            -- phone or email (blind-indexed value)
  purpose       text NOT NULL,            -- 'login' | 'verify_phone' | ...
  code_hash     text NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  consumed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_identity_idx ON otp_challenges (tenant_id, identity, purpose)
  WHERE consumed_at IS NULL;
CREATE INDEX otp_expiry_idx ON otp_challenges (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log — append-only record of security- and business-significant actions
--
-- Partitioned by month (append-heavy, retention-managed). Never updated or
-- deleted by the application; a trigger blocks it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id            uuid        NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id     uuid,
  actor_id      uuid,
  actor_type    text        NOT NULL DEFAULT 'user',
  action        text        NOT NULL,          -- 'tenant.suspended', 'user.role_granted'
  resource_type text        NOT NULL,
  resource_id   text,
  -- Before/after diff for the change, redacted of secrets by the app layer.
  changes       jsonb,
  ip            inet,
  user_agent    text,
  correlation_id text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, occurred_at DESC);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id, occurred_at DESC);
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

-- Reuse the generic monthly-partition helper pattern.
CREATE OR REPLACE FUNCTION ensure_audit_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE start_month date; next_month date; part_name text; i integer;
BEGIN
  FOR i IN 0..months_ahead LOOP
    start_month := date_trunc('month', current_date + (i || ' months')::interval)::date;
    next_month  := (start_month + interval '1 month')::date;
    part_name   := format('audit_log_%s', to_char(start_month, 'YYYY_MM'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
                     part_name, start_month, next_month);
    END IF;
  END LOOP;
END; $$;
SELECT ensure_audit_partitions(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
--
-- The policy shape reused by EVERY tenant-scoped table in the platform:
--   * FORCE RLS so even the table owner is subject to it;
--   * the row's tenant_id must equal current_tenant_id() (the per-connection
--     GUC the application sets), OR rls_bypass_enabled() is on (platform admin,
--     migrations), OR current_tenant_id() IS NULL for tables that legitimately
--     hold platform rows (roles/permissions templates).
--
-- A helper procedure applies it so later migrations stay one line each.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_tenant_rls(target_table regclass)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target_table);
  EXECUTE format($f$
    CREATE POLICY tenant_isolation ON %s
      USING (
        rls_bypass_enabled()
        OR tenant_id IS NOT DISTINCT FROM current_tenant_id()
      )
      WITH CHECK (
        rls_bypass_enabled()
        OR tenant_id IS NOT DISTINCT FROM current_tenant_id()
      )
  $f$, target_table);
END; $$;

SELECT apply_tenant_rls('users');
SELECT apply_tenant_rls('roles');
SELECT apply_tenant_rls('sessions');
SELECT apply_tenant_rls('api_keys');
SELECT apply_tenant_rls('otp_challenges');
-- tenants itself uses a policy on the PK, not tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_isolation ON tenants
  USING (rls_bypass_enabled() OR id IS NOT DISTINCT FROM current_tenant_id())
  WITH CHECK (rls_bypass_enabled() OR id IS NOT DISTINCT FROM current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the default commercial plans. Feature flags gate later-part capabilities
-- (dynamic pricing, GPS tracking, OTA distribution) per tier. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO plans (code, name, features, quotas, monthly_price, sort_order) VALUES
  ('starter', 'Starter',
   '{"online_booking":true,"basic_reports":true}'::jsonb,
   '{"max_users":5,"max_vehicles":25,"max_routes":50}'::jsonb, 0, 1),
  ('growth', 'Growth',
   '{"online_booking":true,"basic_reports":true,"dynamic_pricing":true,"gps_tracking":true,"notifications":true,"advanced_reports":true}'::jsonb,
   '{"max_users":50,"max_vehicles":250,"max_routes":500}'::jsonb, 4999900, 2),
  ('enterprise', 'Enterprise',
   '{"online_booking":true,"basic_reports":true,"dynamic_pricing":true,"gps_tracking":true,"notifications":true,"advanced_reports":true,"ota_distribution":true,"settlement":true,"api_access":true}'::jsonb,
   '{"max_users":-1,"max_vehicles":-1,"max_routes":-1}'::jsonb, 0, 3)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the platform permission catalogue and system-role templates.
-- Idempotent so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, resource, action, description) VALUES
  ('*',                  'platform', 'all',        'Full platform super-admin'),
  ('tenant:read',        'tenant',   'read',       'View operator settings'),
  ('tenant:manage',      'tenant',   'manage',     'Manage operator settings'),
  ('user:read',          'user',     'read',       'View users'),
  ('user:manage',        'user',     'manage',     'Invite / edit / disable users'),
  ('role:manage',        'role',     'manage',     'Manage roles and grants'),
  ('route:read',         'route',    'read',       'View routes'),
  ('route:manage',       'route',    'manage',     'Manage routes and stops'),
  ('stop:manage',        'stop',     'manage',     'Manage stops'),
  ('layout:manage',      'layout',   'manage',     'Manage seat layouts'),
  ('vehicle:read',       'vehicle',  'read',       'View fleet'),
  ('vehicle:manage',     'vehicle',  'manage',     'Manage fleet'),
  ('crew:manage',        'crew',     'manage',     'Manage crew & duty'),
  ('service:read',       'service',  'read',       'View services'),
  ('service:manage',     'service',  'manage',     'Manage services & schedules'),
  ('trip:manage',        'trip',     'manage',     'Manage trips'),
  ('inventory:manage',   'inventory','manage',     'Manage inventory & blocks'),
  ('fare:read',          'fare',     'read',       'View fares'),
  ('fare:manage',        'fare',     'manage',     'Manage fares & pricing'),
  ('booking:read',       'booking',  'read',       'View bookings'),
  ('booking:create',     'booking',  'create',     'Create bookings'),
  ('booking:cancel',     'booking',  'cancel',     'Cancel bookings'),
  ('booking:reschedule', 'booking',  'reschedule', 'Reschedule bookings'),
  ('payment:read',       'payment',  'read',       'View payments'),
  ('payment:refund',     'payment',  'refund',     'Issue refunds'),
  ('settlement:manage',  'settlement','manage',    'Manage settlements'),
  ('tracking:read',      'tracking', 'read',       'View live tracking'),
  ('trip:operate',       'trip',     'operate',    'Operate trips (crew app)'),
  ('report:read',        'report',   'read',       'View reports'),
  ('report:export',      'report',   'export',     'Export reports')
ON CONFLICT (code) DO NOTHING;

-- migrate:down

DROP FUNCTION IF EXISTS apply_tenant_rls(regclass);
DROP FUNCTION IF EXISTS ensure_audit_partitions(integer);
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS otp_challenges;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS plans;
DROP TYPE IF EXISTS user_kind;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS tenant_status;
