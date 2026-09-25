-- =============================================================================
-- 0079_service_history_and_blackouts
--
-- Schedule management (#269, #270, #271):
--   - service_versions: every change to a service's timetable (departure
--     minute, recurrence, bus type / default bus) is snapshotted, so the
--     history can be shown and any earlier version restored (as a new one).
--   - route_blackouts: dates a route does not run (a festival, a road
--     closure). Materialisation skips them; the operator is shown the trips
--     that already had bookings on those dates.
-- =============================================================================

-- migrate:up
CREATE TABLE service_versions (
  service_id      uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot        jsonb NOT NULL,            -- {startMinute, recurrence, vehicleTypeId, defaultVehicleId}
  note            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, version_number)
);
SELECT apply_tenant_rls('service_versions');

-- The current state of every existing service is its version 1.
INSERT INTO service_versions (service_id, version_number, tenant_id, snapshot, note)
SELECT id, 1, tenant_id,
       jsonb_build_object('startMinute', start_minute, 'recurrence', recurrence,
                          'vehicleTypeId', vehicle_type_id, 'defaultVehicleId', default_vehicle_id),
       'Existing timetable'
  FROM services WHERE deleted_at IS NULL;

CREATE TABLE route_blackouts (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id    uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  blackout_date date NOT NULL,
  reason      text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, blackout_date)
);
SELECT apply_tenant_rls('route_blackouts');

-- migrate:down
DROP TABLE IF EXISTS route_blackouts;
DROP TABLE IF EXISTS service_versions;
