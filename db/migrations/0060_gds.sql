-- =============================================================================
-- 0060_gds — platform-level Global Distribution System
--
-- ONE partner account (an OTA like redBus / AbhiBus / Paytm, or a multi-
-- operator travel agent) integrates ONCE and sells EVERY operator that has
-- agreed to distribute to it. Before this, API keys were per operator, so an
-- OTA needed a separate integration per operator — not a GDS.
--
--   gds_partners      platform-level account: prepaid/postpaid, credit limit,
--                     one signed balance (same model as agents, migration 0049)
--   gds_partner_keys  API keys (sha256-hashed, prefix-indexed, IP allow-list,
--                     sandbox flag, expiry, revocation)
--   gds_partner_ledger append-only, idempotent per (partner, kind, reference)
--   gds_agreements    per operator × partner: the OPERATOR decides whether a
--                     partner may sell its seats and at what commission
--   trips/services.closed_channels  channel-wise sales control (e.g. stop OTA
--                     sales for a trip while direct web stays open)
-- =============================================================================

-- migrate:up
CREATE TABLE gds_partners (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name                text NOT NULL,
  kind                text NOT NULL DEFAULT 'ota' CHECK (kind IN ('ota', 'agent')),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  status_reason       text,
  billing_mode        text NOT NULL DEFAULT 'prepaid' CHECK (billing_mode IN ('prepaid', 'postpaid')),
  credit_limit_minor  bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  balance_minor       bigint NOT NULL DEFAULT 0,
  default_commission_pct numeric(5,2) NOT NULL DEFAULT 8 CHECK (default_commission_pct BETWEEN 0 AND 30),
  contact_email       text,
  contact_phone       text,
  gstin               text,
  webhook_url         text CHECK (webhook_url IS NULL OR webhook_url ~ '^https://'),
  webhook_secret      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gds_partners_prepaid_no_credit CHECK (billing_mode = 'postpaid' OR credit_limit_minor = 0),
  CONSTRAINT gds_partners_spend_within_limit CHECK (balance_minor + credit_limit_minor >= 0)
);
CREATE TRIGGER gds_partners_updated_at BEFORE UPDATE ON gds_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE gds_partner_keys (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  partner_id    uuid NOT NULL REFERENCES gds_partners(id) ON DELETE CASCADE,
  label         text NOT NULL,
  prefix        text NOT NULL UNIQUE,
  key_hash      text NOT NULL,
  sandbox       boolean NOT NULL DEFAULT false,
  ip_allowlist  cidr[] NOT NULL DEFAULT '{}',
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gds_partner_keys_partner_idx ON gds_partner_keys (partner_id) WHERE revoked_at IS NULL;

CREATE TABLE gds_partner_ledger (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  partner_id          uuid NOT NULL REFERENCES gds_partners(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('deposit', 'payment_received', 'booking_debit', 'commission_credit', 'booking_reversal', 'refund_credit', 'commission_reversal', 'adjustment')),
  amount_minor        bigint NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor bigint NOT NULL,
  tenant_id           uuid REFERENCES tenants(id),
  booking_id          uuid REFERENCES bookings(id),
  reference           text,
  note                text,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gds_partner_ledger_partner_idx ON gds_partner_ledger (partner_id, created_at DESC);
CREATE UNIQUE INDEX gds_partner_ledger_idem_uq ON gds_partner_ledger (partner_id, kind, reference) WHERE reference IS NOT NULL;

CREATE TABLE gds_agreements (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES gds_partners(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  commission_pct  numeric(5,2) NOT NULL CHECK (commission_pct BETWEEN 0 AND 30),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, partner_id)
);
CREATE INDEX gds_agreements_partner_idx ON gds_agreements (partner_id) WHERE status = 'active';
SELECT apply_tenant_rls('gds_agreements');

ALTER TABLE bookings ADD COLUMN gds_partner_id uuid REFERENCES gds_partners(id);
CREATE INDEX bookings_gds_partner_idx ON bookings (gds_partner_id, created_at DESC) WHERE gds_partner_id IS NOT NULL;

ALTER TABLE trips ADD COLUMN closed_channels text[] NOT NULL DEFAULT '{}'
  CHECK (closed_channels <@ ARRAY['direct_web', 'agent', 'ota', 'phone']::text[]);
ALTER TABLE services ADD COLUMN closed_channels text[] NOT NULL DEFAULT '{}'
  CHECK (closed_channels <@ ARRAY['direct_web', 'agent', 'ota', 'phone']::text[]);

-- migrate:down
ALTER TABLE services DROP COLUMN IF EXISTS closed_channels;
ALTER TABLE trips DROP COLUMN IF EXISTS closed_channels;
DROP INDEX IF EXISTS bookings_gds_partner_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS gds_partner_id;
DROP TABLE IF EXISTS gds_agreements;
DROP TABLE IF EXISTS gds_partner_ledger;
DROP TABLE IF EXISTS gds_partner_keys;
DROP TABLE IF EXISTS gds_partners;
