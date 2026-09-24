-- =============================================================================
-- 0037_operator_refund_policy
--
-- refund-policy.ts's own comment claims "each operator sets its own tiers,
-- this engine just applies them correctly" — but BookingService.cancel()
-- has ALWAYS passed the hardcoded DEFAULT_REFUND_POLICY, for every tenant,
-- with no way to override it. This closes that gap: a NULL value here means
-- "use the platform default" (so every existing/未-configured operator's
-- behaviour is completely unchanged), a non-NULL value is that operator's
-- own tiers, validated against the exact same RefundPolicy shape the
-- computation engine already expects.
-- =============================================================================

-- migrate:up

ALTER TABLE tenants ADD COLUMN refund_policy jsonb;

-- migrate:down

ALTER TABLE tenants DROP COLUMN IF EXISTS refund_policy;
