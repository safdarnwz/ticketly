-- migrate:up
-- 0103_point_charges
-- An operator can charge extra for boarding at, or getting off at, a particular
-- point on a route (a far pickup, a door-step drop). Per seat, in paise, added
-- to the fare before GST. 0 = no charge.
ALTER TABLE route_stops
  ADD COLUMN board_charge_minor integer NOT NULL DEFAULT 0 CHECK (board_charge_minor BETWEEN 0 AND 100000),
  ADD COLUMN drop_charge_minor  integer NOT NULL DEFAULT 0 CHECK (drop_charge_minor BETWEEN 0 AND 100000);

-- migrate:down
ALTER TABLE route_stops DROP COLUMN IF EXISTS board_charge_minor, DROP COLUMN IF EXISTS drop_charge_minor;
