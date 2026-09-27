-- =============================================================================
-- 0109_bus_reviews
--
-- A review belongs to the BUS that ran the trip, not to the route: on one
-- route an operator runs different buses (a full sleeper, a semi-sleeper, a
-- seater), each with its own layout, fares and crew, and passengers rate the
-- bus they rode. If bus ABCD is rated 4 stars and later XYZ runs the trip
-- instead, the 4 stars stay with ABCD. vehicle_id is the bus on the trip
-- when the review is written (after it has left).
--
-- liked: what the traveller liked (cleanliness, punctuality…) — summed per
-- bus into "loved by travellers".
-- =============================================================================

-- migrate:up

ALTER TABLE reviews ADD COLUMN vehicle_id uuid REFERENCES vehicles(id);
ALTER TABLE reviews ADD COLUMN liked text[] NOT NULL DEFAULT '{}';
ALTER TABLE reviews ADD CONSTRAINT reviews_liked_known CHECK (
  liked <@ ARRAY['cleanliness','punctuality','comfort','staff','ac','driving','tracking','rest_stops']::text[]
);
UPDATE reviews r SET vehicle_id = t.vehicle_id FROM trips t WHERE t.id = r.trip_id AND r.vehicle_id IS NULL;
CREATE INDEX reviews_vehicle_idx ON reviews (tenant_id, vehicle_id) WHERE status = 'published';

-- migrate:down

DROP INDEX IF EXISTS reviews_vehicle_idx;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_liked_known;
ALTER TABLE reviews DROP COLUMN IF EXISTS liked;
ALTER TABLE reviews DROP COLUMN IF EXISTS vehicle_id;
