-- =============================================================================
-- 0083_notification_booking_link
--
-- A booking's customer documents (the e-ticket email and the GST invoice email)
-- are logged against the booking and by kind, so the platform can see for any
-- booking whether each one went out, and a redelivered event never sends either
-- one twice.
-- =============================================================================

-- migrate:up
ALTER TABLE notifications ADD COLUMN booking_id uuid, ADD COLUMN kind text;
CREATE INDEX notifications_booking_idx ON notifications (booking_id) WHERE booking_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS notifications_booking_idx;
ALTER TABLE notifications DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS booking_id;
