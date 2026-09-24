-- =============================================================================
-- 0018_platform_wide_content_and_admin
--
-- Five modules move from per-OPERATOR to platform-wide, reflecting the actual
-- domain shape: customers browse ONE central site (www.ticketly.com), so
-- content/offers, currency conversion, fraud review, privacy consent, and the
-- admin console's own theme are Ticketly-the-company's concern, not any one
-- operator's:
--   - cms_pages, cms_banners, offers   (CMS & Offers)
--   - fraud_assessments                (Risk & Fraud)
--   - translations, fx_rates           (i18n & Currency)
--   - consents, erasure_requests       (Privacy / DPDP — customers are
--                                        tenant-less anyway, see 0017)
--   - appearance_settings              (the app.ticketly.com console's OWN
--                                        theme — no longer per-operator;
--                                        operator consoles now render with
--                                        the platform default)
--
-- Each table: drop the tenant_isolation RLS policy + disable RLS (nothing
-- left to isolate), drop the tenant_id column, and narrow the unique
-- constraint that used to include it.
-- =============================================================================

-- migrate:up

-- CMS & Offers
DROP POLICY IF EXISTS tenant_isolation ON cms_pages;
ALTER TABLE cms_pages DISABLE ROW LEVEL SECURITY;
ALTER TABLE cms_pages DROP CONSTRAINT IF EXISTS cms_pages_tenant_id_slug_key;
ALTER TABLE cms_pages DROP COLUMN tenant_id;
ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_slug_key UNIQUE (slug);

DROP POLICY IF EXISTS tenant_isolation ON cms_banners;
ALTER TABLE cms_banners DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS cms_banners_active_idx;
ALTER TABLE cms_banners DROP COLUMN tenant_id;
CREATE INDEX cms_banners_active_idx ON cms_banners (is_active, sort_order);

DROP POLICY IF EXISTS tenant_isolation ON offers;
ALTER TABLE offers DISABLE ROW LEVEL SECURITY;
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_tenant_id_code_key;
DROP INDEX IF EXISTS offers_live_idx;
ALTER TABLE offers DROP COLUMN tenant_id;
ALTER TABLE offers ADD CONSTRAINT offers_code_key UNIQUE (code);
CREATE INDEX offers_live_idx ON offers (is_active, valid_from, valid_to);

-- Risk & Fraud
DROP POLICY IF EXISTS tenant_isolation ON fraud_assessments;
ALTER TABLE fraud_assessments DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS fraud_assessments_review_idx;
ALTER TABLE fraud_assessments DROP COLUMN tenant_id;
CREATE INDEX fraud_assessments_review_idx ON fraud_assessments (decision) WHERE decision IN ('review', 'deny');

-- i18n & Currency
DROP POLICY IF EXISTS tenant_isolation ON translations;
ALTER TABLE translations DISABLE ROW LEVEL SECURITY;
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_tenant_id_locale_key_key;
ALTER TABLE translations DROP COLUMN tenant_id;
ALTER TABLE translations ADD CONSTRAINT translations_locale_key_key UNIQUE (locale, key);

DROP POLICY IF EXISTS tenant_isolation ON fx_rates;
ALTER TABLE fx_rates DISABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_tenant_id_base_currency_quote_currency_as_of_key;
DROP INDEX IF EXISTS fx_rates_latest_idx;
ALTER TABLE fx_rates DROP COLUMN tenant_id;
ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_base_currency_quote_currency_as_of_key UNIQUE (base_currency, quote_currency, as_of);
CREATE INDEX fx_rates_latest_idx ON fx_rates (base_currency, quote_currency, as_of DESC);

-- Privacy (DPDP)
DROP POLICY IF EXISTS tenant_isolation ON consents;
ALTER TABLE consents DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS consents_customer_idx;
ALTER TABLE consents DROP COLUMN tenant_id;
CREATE INDEX consents_customer_idx ON consents (customer_id, purpose, created_at DESC);

DROP POLICY IF EXISTS tenant_isolation ON erasure_requests;
ALTER TABLE erasure_requests DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS erasure_requests_working_idx;
ALTER TABLE erasure_requests DROP COLUMN tenant_id;
CREATE INDEX erasure_requests_working_idx ON erasure_requests (status) WHERE status = 'pending';

-- Appearance (the console's own theme — one platform-wide theme + per-role overrides)
DROP POLICY IF EXISTS tenant_isolation ON appearance_settings;
ALTER TABLE appearance_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE appearance_settings DROP CONSTRAINT IF EXISTS appearance_settings_tenant_id_scope_key;
ALTER TABLE appearance_settings DROP COLUMN tenant_id;
ALTER TABLE appearance_settings ADD CONSTRAINT appearance_settings_scope_key UNIQUE (scope);

-- migrate:down

ALTER TABLE cms_pages ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE cms_pages DROP CONSTRAINT IF EXISTS cms_pages_slug_key;
SELECT apply_tenant_rls('cms_pages');

ALTER TABLE cms_banners ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS cms_banners_active_idx;
CREATE INDEX cms_banners_active_idx ON cms_banners (tenant_id, is_active, sort_order);
SELECT apply_tenant_rls('cms_banners');

ALTER TABLE offers ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_code_key;
DROP INDEX IF EXISTS offers_live_idx;
CREATE INDEX offers_live_idx ON offers (tenant_id, is_active, valid_from, valid_to);
SELECT apply_tenant_rls('offers');

ALTER TABLE fraud_assessments ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS fraud_assessments_review_idx;
CREATE INDEX fraud_assessments_review_idx ON fraud_assessments (tenant_id, decision) WHERE decision IN ('review', 'deny');
SELECT apply_tenant_rls('fraud_assessments');

ALTER TABLE translations ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_locale_key_key;
SELECT apply_tenant_rls('translations');

ALTER TABLE fx_rates ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_base_currency_quote_currency_as_of_key;
DROP INDEX IF EXISTS fx_rates_latest_idx;
CREATE INDEX fx_rates_latest_idx ON fx_rates (tenant_id, base_currency, quote_currency, as_of DESC);
SELECT apply_tenant_rls('fx_rates');

ALTER TABLE consents ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS consents_customer_idx;
CREATE INDEX consents_customer_idx ON consents (tenant_id, customer_id, purpose, created_at DESC);
SELECT apply_tenant_rls('consents');

ALTER TABLE erasure_requests ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS erasure_requests_working_idx;
CREATE INDEX erasure_requests_working_idx ON erasure_requests (tenant_id, status) WHERE status = 'pending';
SELECT apply_tenant_rls('erasure_requests');

ALTER TABLE appearance_settings ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE appearance_settings DROP CONSTRAINT IF EXISTS appearance_settings_scope_key;
SELECT apply_tenant_rls('appearance_settings');
