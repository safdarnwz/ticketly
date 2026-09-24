-- =============================================================================
-- 0038_per_passenger_trip_reminder
--
-- TripReminderScheduler swept trips.departs_at (the ORIGIN's departure
-- instant) and reminded every confirmed booking on that trip at the same
-- moment — 6h before the bus left its FIRST stop. On a long multi-stop
-- route (e.g. Kolkata -> ... -> Sasaram -> ... -> Delhi), a passenger
-- boarding at Sasaram many hours after the bus left Kolkata got their
-- reminder relative to a departure time that had nothing to do with when
-- THEY needed to reach their own boarding point — potentially a full day
-- early, or (worse) too late if their stop's actual time already passed
-- the origin-based window.
--
-- The reminder must be relative to each PASSENGER's own boarding-stop
-- time, not the trip's origin departure — so the idempotency flag moves
-- from the trip (one moment, shared by everyone) to the booking (one
-- moment per passenger, since different bookings on the same trip can
-- board at completely different stops and times).
-- =============================================================================

-- migrate:up

ALTER TABLE bookings ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE trips DROP COLUMN IF EXISTS reminder_sent_at;

-- migrate:down

ALTER TABLE trips ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE bookings DROP COLUMN IF EXISTS reminder_sent_at;
