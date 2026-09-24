-- =============================================================================
-- 0052_refund_per_cancellation
--
-- A cancellation produces AT MOST one live refund. Enforced in the database
-- (not just the service check) so two concurrent deliveries of the same
-- cancellation event can never both create a refund. Failed/cancelled
-- attempts are excluded so a refund can still be retried after a failure.
-- =============================================================================

-- migrate:up
-- dispatch_attempt: the PSP idempotency key is refund id (+ "-<attempt>"
-- for retries). Re-sending the SAME attempt after a crash can never refund
-- twice; a deliberate retry after a FAILED attempt gets a fresh key (the PSP
-- would otherwise just replay the old failure).
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS dispatch_attempt integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS refunds_pending_dispatch_idx ON refunds (updated_at)
  WHERE status = 'processing' AND gateway_refund_id IS NULL AND destination = 'source';

CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_live_per_cancellation_uq
  ON refunds (cancellation_id)
  WHERE cancellation_id IS NOT NULL AND status IN ('initiated', 'processing', 'settled', 'manual');

-- migrate:down
DROP INDEX IF EXISTS refunds_one_live_per_cancellation_uq;
DROP INDEX IF EXISTS refunds_pending_dispatch_idx;
ALTER TABLE refunds DROP COLUMN IF EXISTS dispatch_attempt;
