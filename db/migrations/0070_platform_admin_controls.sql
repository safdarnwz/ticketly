-- =============================================================================
-- 0070_platform_admin_controls
--
-- Super-admin controls from the scenario tracker (#1–#120 batch):
--   - integration_credentials: payment / SMS / WhatsApp / SMTP credentials,
--     secrets encrypted at rest by the app (FieldEncryptor), never returned.
--   - users.password_changed_at: drives the password-expiry policy.
--   - tenants.api_rate_limit: per-operator API rate limit override.
--   - role_templates: platform-wide role → permission bundles an operator
--     can apply to create a tenant role in one click.
--   - maintenance_windows: scheduled (future) maintenance, with the time
--     operators were notified about it.
--   - operator_broadcasts: history of bulk notifications sent to operators.
--   - platform_discounts / platform_invoices: the platform's own GST invoice
--     to an operator for its platform charges, with discounts applied.
-- =============================================================================

-- migrate:up

-- ── integration credentials (platform-level, no tenant) ─────────────────────
CREATE TABLE integration_credentials (
  provider        text PRIMARY KEY,                -- 'razorpay' | 'payu' | 'easebuzz' | 'paytm' | 'msg91_sms' | 'msg91_whatsapp' | 'smtp'
  enabled         boolean NOT NULL DEFAULT false,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non-secret settings (sender id, host, port, merchant id…)
  secrets         text,                            -- encrypted JSON of the secret fields
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── password expiry ─────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION users_track_password_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.password_changed_at := now();
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER users_password_changed_at BEFORE UPDATE OF password_hash ON users
  FOR EACH ROW EXECUTE FUNCTION users_track_password_change();

-- ── per-operator API rate limit (requests per rate-limit window; NULL = platform default) ──
ALTER TABLE tenants ADD COLUMN api_rate_limit integer CHECK (api_rate_limit IS NULL OR api_rate_limit > 0);

-- ── global role templates ───────────────────────────────────────────────────
CREATE TABLE role_templates (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  permissions  text[] NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE TRIGGER role_templates_updated_at BEFORE UPDATE ON role_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── scheduled maintenance windows ───────────────────────────────────────────
CREATE TABLE maintenance_windows (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  message       text NOT NULL DEFAULT '',
  notified_at   timestamptz,
  cancelled_at  timestamptz,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX maintenance_windows_active_idx ON maintenance_windows (starts_at, ends_at) WHERE cancelled_at IS NULL;

-- ── bulk notifications to operators ─────────────────────────────────────────
CREATE TABLE operator_broadcasts (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject        text NOT NULL,
  body           text NOT NULL,
  audience       text NOT NULL DEFAULT 'active',   -- 'active' | 'all' | 'suspended'
  recipients     integer NOT NULL DEFAULT 0,
  sent           integer NOT NULL DEFAULT 0,
  failed         integer NOT NULL DEFAULT 0,
  source         text NOT NULL DEFAULT 'manual',   -- 'manual' | 'maintenance'
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── platform discounts (applied on the platform's invoice to an operator) ───
CREATE TABLE platform_discounts (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = every operator
  kind           text NOT NULL CHECK (kind IN ('percent', 'flat')),
  value          numeric(12,2) NOT NULL CHECK (value > 0),       -- percent (0–100] or flat minor units
  reason         text NOT NULL,
  valid_from     date NOT NULL,
  valid_to       date,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX platform_discounts_tenant_idx ON platform_discounts (tenant_id) WHERE revoked_at IS NULL;

-- ── platform invoices (platform → operator) ─────────────────────────────────
-- Gapless numbering per financial year, like the operator's own tax invoices.
CREATE TABLE platform_invoice_sequences (
  financial_year text PRIMARY KEY,                 -- '2026-27'
  last_number    integer NOT NULL DEFAULT 0
);

CREATE TABLE platform_invoices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number  text NOT NULL UNIQUE,
  period_from     date NOT NULL,
  period_to       date NOT NULL,
  lines           jsonb NOT NULL,                  -- [{kind, description, count, baseMinor, gstMinor}]
  subtotal_minor  bigint NOT NULL,                 -- sum of line bases
  discount_minor  bigint NOT NULL DEFAULT 0,
  gst_minor       bigint NOT NULL,                 -- GST after discount
  total_minor     bigint NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'INR',
  discount_ids    uuid[] NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_from, period_to),
  CHECK (period_to >= period_from)
);
SELECT apply_tenant_rls('platform_invoices');

-- migrate:down
DROP TABLE IF EXISTS platform_invoices;
DROP TABLE IF EXISTS platform_invoice_sequences;
DROP TABLE IF EXISTS platform_discounts;
DROP TABLE IF EXISTS operator_broadcasts;
DROP TABLE IF EXISTS maintenance_windows;
DROP TABLE IF EXISTS role_templates;
ALTER TABLE tenants DROP COLUMN IF EXISTS api_rate_limit;
DROP TRIGGER IF EXISTS users_password_changed_at ON users;
DROP FUNCTION IF EXISTS users_track_password_change();
ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
DROP TABLE IF EXISTS integration_credentials;
