-- =============================================================================
-- 0090_refund_payout
--
-- A refund to a bank account the customer gave is sent by a person, by bank
-- transfer. There was no way to record that it had been sent: it stayed
-- "processing" for ever. Record the transfer reference (UTR), who sent it and
-- when; index the refunds queue the operator works from.
-- =============================================================================

-- migrate:up
ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS refunds_queue_idx ON refunds (tenant_id, status, created_at DESC);

-- migrate:down
DROP INDEX IF EXISTS refunds_queue_idx;
ALTER TABLE refunds
  DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS paid_by,
  DROP COLUMN IF EXISTS payout_reference;
