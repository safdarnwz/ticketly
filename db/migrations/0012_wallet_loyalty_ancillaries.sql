-- =============================================================================
-- 0012_wallet_loyalty_ancillaries
--
-- Customer wallet (append-only per-customer ledger), loyalty points ledger,
-- referral program, and ancillary add-on services (insurance, meals, luggage).
-- Wallet and loyalty balances are the SUM of their entries — never a mutable
-- counter — so they can't drift or be double-spent under concurrency.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- wallet_entries — refundable store credit as an append-only ledger. Balance =
-- sum(amount_minor). Debits are validated against a row-locked balance at spend
-- time so the wallet can never go negative under concurrent bookings.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE wallet_entries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type    text NOT NULL,             -- 'topup'|'refund_credit'|'booking_debit'|'reversal'|...
  amount_minor  bigint NOT NULL,           -- signed: + credit, − debit
  currency      char(3) NOT NULL DEFAULT 'INR',
  source_type   text,                      -- 'booking'|'refund'|'payment'
  source_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_balance_idx ON wallet_entries (tenant_id, customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- loyalty_ledger — points as an append-only ledger, same discipline. Balance =
-- sum(points); lifetime = sum of positive earn/referral (drives tier).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE loyalty_ledger (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  txn_type      text NOT NULL,             -- 'earn'|'redeem'|'expire'|'referral'|'refund_reverse'
  points        integer NOT NULL,          -- signed
  source_type   text,
  source_id     text,
  -- Earned points can expire; the sweeper expires past this.
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_ledger_customer_idx ON loyalty_ledger (tenant_id, customer_id);
CREATE INDEX loyalty_ledger_expiry_idx ON loyalty_ledger (expires_at) WHERE txn_type = 'earn' AND expires_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- referrals — refer-a-friend. The referrer earns a reward when the referee
-- completes their first booking. One referral row per (referrer, referee).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE referrals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referrer_id     uuid NOT NULL REFERENCES users(id),
  referee_id      uuid REFERENCES users(id),
  referral_code   text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',  -- 'pending'|'rewarded'|'expired'
  reward_points   integer NOT NULL DEFAULT 0,
  rewarded_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, referrer_id, referee_id)
);
CREATE INDEX referrals_code_idx ON referrals (tenant_id, referral_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- ancillary_services — the add-on catalogue (travel insurance, meal, extra
-- luggage, priority boarding) an operator offers, with a price.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ancillary_services (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  kind          text NOT NULL,             -- 'insurance'|'meal'|'luggage'|'priority'|'other'
  price_minor   bigint NOT NULL DEFAULT 0,
  -- Per-passenger (meal) or per-booking (insurance).
  per_passenger boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER ancillary_services_updated_at BEFORE UPDATE ON ancillary_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_ancillaries — add-ons attached to a booking, with the price captured
-- at purchase time (so a later catalogue price change doesn't rewrite history).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE booking_ancillaries (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  ancillary_id      uuid NOT NULL REFERENCES ancillary_services(id),
  quantity          smallint NOT NULL DEFAULT 1,
  unit_price_minor  bigint NOT NULL,
  total_minor       bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_ancillaries_booking_idx ON booking_ancillaries (booking_id);

SELECT apply_tenant_rls('wallet_entries');
SELECT apply_tenant_rls('loyalty_ledger');
SELECT apply_tenant_rls('referrals');
SELECT apply_tenant_rls('ancillary_services');
SELECT apply_tenant_rls('booking_ancillaries');

-- migrate:down

DROP TABLE IF EXISTS booking_ancillaries;
DROP TABLE IF EXISTS ancillary_services;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS loyalty_ledger;
DROP TABLE IF EXISTS wallet_entries;
