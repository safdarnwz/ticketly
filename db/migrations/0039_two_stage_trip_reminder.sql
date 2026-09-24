-- =============================================================================
-- 0039_two_stage_trip_reminder
--
-- Splits the single per-passenger reminder (migration 0038) into two
-- distinct notifications, each with different content and its own
-- idempotency tracking (a booking can be due for one without being due
-- for the other):
--
--   12h before boarding: passenger name(s), PNR, seat numbers, boarding
--   point name, dropping point name, boarding/dropping times — the full
--   "here's your trip" picture. Deliberately NO live-tracking/GPS link —
--   12 hours out, the bus is not running yet, so a tracking link would
--   just be dead weight in the message.
--
--   4h before boarding: the OPERATIONAL details a passenger actually
--   needs to physically get on the bus — exact pickup location (landmark,
--   address, coordinates), the assigned driver's and attendant's names
--   and phone numbers, and the bus's registration number.
-- =============================================================================

-- migrate:up

ALTER TABLE bookings RENAME COLUMN reminder_sent_at TO reminder_4h_sent_at;
ALTER TABLE bookings ADD COLUMN reminder_12h_sent_at timestamptz;

-- migrate:down

ALTER TABLE bookings DROP COLUMN IF EXISTS reminder_12h_sent_at;
ALTER TABLE bookings RENAME COLUMN reminder_4h_sent_at TO reminder_sent_at;
