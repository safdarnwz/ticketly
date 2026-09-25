-- =============================================================================
-- 0077_seat_and_sales_rules
--
-- Seat attributes and per-service sales rules (scenario tracker #141, #170,
-- #173, #174, #294):
--   - trip_seats.accessible: a disability-friendly seat (copied from the seat
--     map's `accessible` flag when a trip's seats are created). Held for
--     passengers in the 'disabled' category until
--     passenger_policies.accessible_release_hours before departure
--     (NULL = never released to others).
--   - services.sales_rules: {"otaReleasePct": 60,
--       "categoryQuotas": {"female": {"seats": 4, "releaseHours": 12},
--                          "senior": {"pct": 10, "releaseHours": 24}}}
--     otaReleasePct caps what OTAs / GDS partners may sell of a trip
--     (absent = the platform default); a category quota keeps that many seats
--     for women / senior citizens until the release time.
-- =============================================================================

-- migrate:up
ALTER TABLE trip_seats ADD COLUMN accessible boolean NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN sales_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE passenger_policies ADD COLUMN accessible_release_hours smallint DEFAULT 24
  CHECK (accessible_release_hours IS NULL OR accessible_release_hours BETWEEN 0 AND 720);

-- migrate:down
ALTER TABLE passenger_policies DROP COLUMN IF EXISTS accessible_release_hours;
ALTER TABLE services DROP COLUMN IF EXISTS sales_rules;
ALTER TABLE trip_seats DROP COLUMN IF EXISTS accessible;
