-- =============================================================================
-- 0084_booking_monitoring_indexes
--
-- The platform's live bookings view reads bookings across every operator:
-- newest first (all operators or one), and today's confirmations and
-- cancellations. Without these each refresh scans the whole table.
-- =============================================================================

-- migrate:up
CREATE INDEX bookings_created_idx ON bookings (created_at DESC, id DESC);
CREATE INDEX bookings_tenant_created_idx ON bookings (tenant_id, created_at DESC, id DESC);
CREATE INDEX bookings_confirmed_at_idx ON bookings (confirmed_at) WHERE confirmed_at IS NOT NULL;
CREATE INDEX bookings_cancelled_at_idx ON bookings (cancelled_at) WHERE cancelled_at IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS bookings_cancelled_at_idx;
DROP INDEX IF EXISTS bookings_confirmed_at_idx;
DROP INDEX IF EXISTS bookings_tenant_created_idx;
DROP INDEX IF EXISTS bookings_created_idx;
