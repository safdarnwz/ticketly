-- =============================================================================
-- 0042_refund_alternate_account
--
-- Refund destination is now 'source' (default) or 'alternate_account' — the
-- customer may supply a DIFFERENT bank account to receive the refund into,
-- instead of the original payment source. 'wallet' is no longer a valid
-- value (the Wallet feature has been removed — see migration 0041); any
-- existing rows with destination='wallet' are recast to 'source' since the
-- money was, in the old wallet-refund flow, real value credited to the
-- customer's own account either way.
--
-- These fields are ONLY populated when destination = 'alternate_account'.
-- Deliberately plain columns, not a separate table — a refund has AT MOST
-- one destination account, decided once at initiation, never edited after.
-- =============================================================================

-- migrate:up

ALTER TABLE refunds ADD COLUMN alt_account_holder text;
ALTER TABLE refunds ADD COLUMN alt_account_number text;
ALTER TABLE refunds ADD COLUMN alt_ifsc text;
ALTER TABLE refunds ADD COLUMN alt_bank_name text;

UPDATE refunds SET destination = 'source' WHERE destination = 'wallet';

-- migrate:down

ALTER TABLE refunds DROP COLUMN IF EXISTS alt_bank_name;
ALTER TABLE refunds DROP COLUMN IF EXISTS alt_ifsc;
ALTER TABLE refunds DROP COLUMN IF EXISTS alt_account_number;
ALTER TABLE refunds DROP COLUMN IF EXISTS alt_account_holder;
