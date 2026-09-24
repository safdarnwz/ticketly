-- =============================================================================
-- 0015_tickets_i18n_privacy
--
-- Part 15 storefront/platform tail: per-tenant translation catalogs and FX
-- rates (i18n + multi-currency display), and DPDP privacy — consent log and
-- right-to-be-forgotten erasure requests. Signed ticket tokens are stateless
-- (HMAC-verified offline), so they need no table.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- translations — per-(tenant, locale) message catalog. An operator can override
-- any string for its storefront; resolution falls back locale → base → en.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE translations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  locale      text NOT NULL,             -- 'en', 'hi', 'hi-IN', ...
  key         text NOT NULL,             -- 'ticket.subject'
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, locale, key)
);
CREATE TRIGGER translations_updated_at BEFORE UPDATE ON translations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- fx_rates — quoted conversion rates (quote units per 1 base unit, ×1e6 so the
-- rate is an exact integer). Latest `as_of` per (base, quote) is the live rate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fx_rates (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency  char(3) NOT NULL,
  quote_currency char(3) NOT NULL,
  rate_micros    bigint NOT NULL CHECK (rate_micros > 0),
  as_of          timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, base_currency, quote_currency, as_of)
);
CREATE INDEX fx_rates_latest_idx ON fx_rates (tenant_id, base_currency, quote_currency, as_of DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- consents — append-only DPDP consent log. Current state per purpose = the
-- latest event. Necessary purposes (transactional) don't require a row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL,             -- 'marketing'|'personalization'|'analytics'|'third_party_share'
  granted     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_customer_idx ON consents (tenant_id, customer_id, purpose, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- erasure_requests — right-to-be-forgotten. Fulfilment ANONYMISES PII in place
-- (bookings/passengers/users) while financial records (invoices/ledger) are
-- legally retained; the request row is the audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE erasure_requests (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',  -- 'pending'|'processed'|'rejected'
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX erasure_requests_working_idx ON erasure_requests (tenant_id, status) WHERE status = 'pending';

SELECT apply_tenant_rls('translations');
SELECT apply_tenant_rls('fx_rates');
SELECT apply_tenant_rls('consents');
SELECT apply_tenant_rls('erasure_requests');

-- migrate:down

DROP TABLE IF EXISTS erasure_requests;
DROP TABLE IF EXISTS consents;
DROP TABLE IF EXISTS fx_rates;
DROP TABLE IF EXISTS translations;
