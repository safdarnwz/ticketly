-- migrate:up
-- 0104_round_trip_discount
-- An operator gives a discount on the return journey of a round trip: the
-- return booking points at its onward booking. One live (held or confirmed)
-- return per onward booking, so the discount cannot be taken twice.
ALTER TABLE passenger_policies
  ADD COLUMN round_trip_discount_pct smallint NOT NULL DEFAULT 0 CHECK (round_trip_discount_pct BETWEEN 0 AND 50);

ALTER TABLE bookings ADD COLUMN return_of uuid REFERENCES bookings(id);
CREATE UNIQUE INDEX bookings_return_of_live_uq ON bookings (return_of)
  WHERE return_of IS NOT NULL AND status IN ('held', 'confirmed');

-- migrate:down
DROP INDEX IF EXISTS bookings_return_of_live_uq;
ALTER TABLE bookings DROP COLUMN IF EXISTS return_of;
ALTER TABLE passenger_policies DROP COLUMN IF EXISTS round_trip_discount_pct;
