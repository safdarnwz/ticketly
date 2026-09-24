-- =============================================================================
-- 0062_extra_trips
-- One-off EXTRA / special trips on top of a service's regular timetable
-- (festival rush, event specials, ladies specials). The old
-- UNIQUE (service_id, journey_date) made that impossible, so uniqueness now
-- applies to REGULAR trips only; any two trips of one service still can't
-- share a departure instant.
-- =============================================================================

-- migrate:up
ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS extra_reason text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS ladies_special boolean NOT NULL DEFAULT false;
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_service_id_journey_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS trips_regular_per_day_uq ON trips (service_id, journey_date) WHERE NOT is_extra;
CREATE UNIQUE INDEX IF NOT EXISTS trips_service_departure_uq ON trips (service_id, departs_at);
ALTER TABLE trips ADD CONSTRAINT trips_extra_reason CHECK (NOT is_extra OR length(coalesce(extra_reason, '')) >= 3);

-- migrate:down
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_extra_reason;
DROP INDEX IF EXISTS trips_service_departure_uq;
DROP INDEX IF EXISTS trips_regular_per_day_uq;
ALTER TABLE trips ADD CONSTRAINT trips_service_id_journey_date_key UNIQUE (service_id, journey_date);
ALTER TABLE trips DROP COLUMN IF EXISTS ladies_special;
ALTER TABLE trips DROP COLUMN IF EXISTS extra_reason;
ALTER TABLE trips DROP COLUMN IF EXISTS is_extra;
