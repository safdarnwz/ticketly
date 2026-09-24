-- =============================================================================
-- 0041_remove_wallet
--
-- The customer Wallet feature (top-up, spend, refund-to-wallet) has been
-- removed from the product entirely, per product decision. All application
-- code paths (WalletRepository, PaymentService.chargeFromCustomerWallet,
-- the 'wallet' refund destination) have already been removed; this drops
-- the now-unused schema cleanly.
-- =============================================================================

-- migrate:up

DROP TABLE IF EXISTS wallet_entries;

-- migrate:down

CREATE TABLE wallet_entries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES users(id),
  entry_type    text NOT NULL, -- 'topup' | 'spend' | 'refund_credit'
  amount_minor  bigint NOT NULL,
  source_type   text,
  source_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_customer_idx ON wallet_entries (tenant_id, customer_id, created_at DESC);
SELECT apply_tenant_rls('wallet_entries');
