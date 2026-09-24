-- =============================================================================
-- 0048_remove_loyalty
--
-- The loyalty-points and referral-reward features have been removed from the
-- product entirely, per product decision — a loyalty program built around
-- points that reward via wallet-style redemption doesn't make sense once the
-- customer Wallet feature itself was removed (migration 0041), and referrals
-- rewarded EXCLUSIVELY via loyalty points, so removing loyalty makes the
-- referral system's entire reward mechanism meaningless too. All application
-- code (LoyaltyService, LoyaltyRepository, LoyaltyController, ReferralService,
-- LoyaltyConsumer, points-engine.ts) has already been removed; this drops the
-- now-unused schema cleanly. Ancillary add-ons (insurance/meals/luggage) are
-- UNRELATED to loyalty and were split into their own standalone module
-- (AncillaryModule) before this migration — ancillary_services and
-- booking_ancillaries are untouched here.
-- =============================================================================

-- migrate:up

DROP TABLE IF EXISTS loyalty_ledger;
DROP TABLE IF EXISTS referrals;

-- migrate:down

CREATE TABLE loyalty_ledger (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  txn_type      text NOT NULL,             -- 'earn'|'redeem'|'expire'|'referral'|'refund_reverse'
  points        integer NOT NULL,          -- signed
  source_type   text,
  source_id     text,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_ledger_customer_idx ON loyalty_ledger (tenant_id, customer_id);
CREATE INDEX loyalty_ledger_expiry_idx ON loyalty_ledger (expires_at) WHERE txn_type = 'earn' AND expires_at IS NOT NULL;
SELECT apply_tenant_rls('loyalty_ledger');

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
SELECT apply_tenant_rls('referrals');
