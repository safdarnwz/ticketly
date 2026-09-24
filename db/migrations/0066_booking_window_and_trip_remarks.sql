-- =============================================================================
-- 0066_booking_window_and_trip_remarks
-- Operator booking window (how far ahead sales open, how long before departure
-- they close) and internal remarks on a trip (staff-only notes).
-- =============================================================================

-- migrate:up
ALTER TABLE passenger_policies ADD COLUMN IF NOT EXISTS max_advance_days smallint CHECK (max_advance_days IS NULL OR max_advance_days BETWEEN 1 AND 365);
ALTER TABLE passenger_policies ADD COLUMN IF NOT EXISTS min_minutes_before_departure smallint NOT NULL DEFAULT 0 CHECK (min_minutes_before_departure BETWEEN 0 AND 1440);

CREATE TABLE trip_remarks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  remark      text NOT NULL CHECK (length(remark) BETWEEN 2 AND 1000),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_remarks_trip_idx ON trip_remarks (trip_id, created_at DESC);
SELECT apply_tenant_rls('trip_remarks');

-- migrate:down
DROP TABLE IF EXISTS trip_remarks;
ALTER TABLE passenger_policies DROP COLUMN IF EXISTS min_minutes_before_departure;
ALTER TABLE passenger_policies DROP COLUMN IF EXISTS max_advance_days;
