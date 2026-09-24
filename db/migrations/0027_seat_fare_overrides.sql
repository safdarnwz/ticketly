-- =============================================================================
-- 0027_seat_fare_overrides
--
-- Fare has always been resolved by (route, segment, SEAT TYPE) — every
-- 'seater' on a trip costs the same. This adds a per-SEAT-NUMBER override on
-- top of a fare plan: an operator can price seat "1" (front row) or "5"
-- (extra legroom / window) differently from the rest of that same seat type,
-- on the SAME route and bus.
--
-- Deliberately flat (not per-segment) for v1 — one override amount per seat
-- number per fare plan, applied regardless of which stops the passenger
-- boards/alights at. A full per-seat-per-segment matrix would be a large
-- data-entry burden for a benefit few operators would use; this covers the
-- common real cases (a specific seat number costs more/less) without it.
-- =============================================================================

-- migrate:up

CREATE TABLE seat_fare_overrides (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fare_plan_id  uuid NOT NULL REFERENCES fare_plans(id) ON DELETE CASCADE,
  seat_number   text NOT NULL,
  fare_minor    bigint NOT NULL CHECK (fare_minor >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fare_plan_id, seat_number)
);
CREATE TRIGGER seat_fare_overrides_updated_at BEFORE UPDATE ON seat_fare_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('seat_fare_overrides');

-- migrate:down

DROP TABLE IF EXISTS seat_fare_overrides;
