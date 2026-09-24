-- =============================================================================
-- 0053_connection_alert_once
--
-- The connection monitor re-checks every active connecting journey on each
-- sweep. Without a record of what was already sent, a leg that stays late
-- would re-alert the passenger on EVERY sweep. These columns make each alert
-- (at-risk, broken) go out exactly once; they are set in the same
-- transaction that records the notification event.
-- =============================================================================

-- migrate:up
ALTER TABLE journey_connections ADD COLUMN IF NOT EXISTS at_risk_notified_at timestamptz;
ALTER TABLE journey_connections ADD COLUMN IF NOT EXISTS broken_notified_at timestamptz;

-- migrate:down
ALTER TABLE journey_connections DROP COLUMN IF EXISTS broken_notified_at;
ALTER TABLE journey_connections DROP COLUMN IF EXISTS at_risk_notified_at;
