-- =============================================================================
-- 0055_trip_vehicle_changes
-- Audit trail of every bus change on a trip: who, when, why, and exactly
-- which seats moved (so passenger support can answer "why is my seat
-- different?" and disputes can be reconstructed).
-- =============================================================================

-- migrate:up
CREATE TABLE trip_vehicle_changes (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id          uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_vehicle_id  uuid REFERENCES vehicles(id),
  to_vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  from_layout_id   uuid REFERENCES seat_layouts(id),
  to_layout_id     uuid NOT NULL REFERENCES seat_layouts(id),
  reason           text NOT NULL,
  seat_moves       jsonb NOT NULL DEFAULT '[]'::jsonb,
  bookings_affected integer NOT NULL DEFAULT 0,
  changed_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_vehicle_changes_trip_idx ON trip_vehicle_changes (trip_id, created_at DESC);
SELECT apply_tenant_rls('trip_vehicle_changes');

-- migrate:down
DROP TABLE IF EXISTS trip_vehicle_changes;
