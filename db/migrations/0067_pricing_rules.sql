-- =============================================================================
-- 0067_pricing_rules
-- Per-route fare floor / ceiling and peak / off-peak windows (by departure
-- time), and a manual per-trip fare adjustment (low-occupancy discount or
-- high-demand hike). See pricing/domain/pricing-rules.ts.
-- =============================================================================

-- migrate:up
CREATE TABLE route_pricing_rules (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id      uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  floor_minor   bigint CHECK (floor_minor IS NULL OR floor_minor >= 0),
  ceiling_minor bigint CHECK (ceiling_minor IS NULL OR ceiling_minor > 0),
  peak_windows  jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, route_id),
  CONSTRAINT route_pricing_bounds CHECK (floor_minor IS NULL OR ceiling_minor IS NULL OR floor_minor <= ceiling_minor)
);
SELECT apply_tenant_rls('route_pricing_rules');

CREATE TABLE trip_fare_adjustments (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  pct         numeric(5,2) NOT NULL CHECK (pct BETWEEN -50 AND 100 AND pct <> 0),
  reason      text NOT NULL CHECK (length(reason) >= 5),
  created_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, trip_id)
);
SELECT apply_tenant_rls('trip_fare_adjustments');

-- migrate:down
DROP TABLE IF EXISTS trip_fare_adjustments;
DROP TABLE IF EXISTS route_pricing_rules;
