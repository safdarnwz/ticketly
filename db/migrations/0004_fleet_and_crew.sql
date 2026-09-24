-- =============================================================================
-- 0004_fleet_and_crew
--
-- Physical fleet (vehicles + their compliance documents, maintenance & fuel
-- logs) and crew (drivers/conductors, their licences, and the duty roster).
-- Scheduling (Part 5) reads this to assign a road-legal vehicle and a
-- conflict-free crew to each trip.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- vehicles — the physical buses. Each references a vehicle_type (Part 3), which
-- supplies its seat layout and amenities.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE vehicle_status AS ENUM ('active', 'maintenance', 'retired');

CREATE TABLE vehicles (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registration_no   text NOT NULL,               -- 'TS09UB1234'
  vehicle_type_id   uuid NOT NULL REFERENCES vehicle_types(id),
  -- A vehicle MAY override its type's default layout (a refit).
  seat_layout_id    uuid REFERENCES seat_layouts(id),
  status            vehicle_status NOT NULL DEFAULT 'active',
  make              text,
  model             text,
  manufacture_year  smallint,
  odometer_km       integer NOT NULL DEFAULT 0,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, registration_no)
);
CREATE INDEX vehicles_tenant_status_idx ON vehicles (tenant_id, status) WHERE deleted_at IS NULL;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- vehicle_documents — permit / insurance / fitness / puc, with expiry dates.
--
-- The `expires_on` is a `date` (calendar day): validity is a calendar concept,
-- and storing it as a timestamp would introduce timezone drift on the boundary
-- day. An index on (tenant_id, expires_on) drives the daily "expiring soon"
-- sweep in the worker.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE vehicle_documents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type      text NOT NULL,                   -- 'permit' | 'insurance' | 'fitness' | 'puc'
  document_no   text,
  valid_from    date,
  expires_on    date NOT NULL,
  issuer        text,
  file_url      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- One current document per (vehicle, type); renewals supersede via update.
  UNIQUE (vehicle_id, doc_type)
);
CREATE INDEX vehicle_documents_expiry_idx ON vehicle_documents (tenant_id, expires_on);
CREATE INDEX vehicle_documents_vehicle_idx ON vehicle_documents (vehicle_id);
CREATE TRIGGER vehicle_documents_updated_at BEFORE UPDATE ON vehicle_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- maintenance & fuel logs — operational history, feeding cost reports (Part 10).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE maintenance_logs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind          text NOT NULL,                   -- 'service' | 'repair' | 'inspection'
  description   text NOT NULL,
  odometer_km   integer,
  cost_minor    bigint NOT NULL DEFAULT 0,       -- integer minor units
  currency      char(3) NOT NULL DEFAULT 'INR',
  performed_on  date NOT NULL,
  next_due_on   date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_vehicle_idx ON maintenance_logs (vehicle_id, performed_on DESC);

CREATE TABLE fuel_logs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  litres        numeric(8,2) NOT NULL,
  cost_minor    bigint NOT NULL DEFAULT 0,
  odometer_km   integer,
  filled_on     date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fuel_vehicle_idx ON fuel_logs (vehicle_id, filled_on DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- crew — drivers and conductors, with licence expiry (a driver with an expired
-- licence is a document-compliance blocker, same idea as vehicle documents).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE crew_role AS ENUM ('driver', 'conductor', 'attendant');
CREATE TYPE crew_status AS ENUM ('active', 'inactive', 'on_leave');

CREATE TABLE crew (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role              crew_role NOT NULL,
  full_name         text NOT NULL,
  phone             text,
  phone_blind       text,               -- encrypted-phone lookup (as in Part 2)
  status            crew_status NOT NULL DEFAULT 'active',
  -- Driver-specific licence details (NULL for conductors).
  licence_no        text,
  licence_expires_on date,
  employee_code     text,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, employee_code)
);
CREATE INDEX crew_tenant_role_idx ON crew (tenant_id, role, status) WHERE deleted_at IS NULL;
CREATE INDEX crew_licence_expiry_idx ON crew (tenant_id, licence_expires_on) WHERE role = 'driver';
CREATE TRIGGER crew_updated_at BEFORE UPDATE ON crew FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- crew_duties — the roster. One row per crew assignment to a trip (Part 5).
--
-- Overlap and rest-rule checking is done in the application (DutyRoster domain),
-- but an exclusion constraint provides a database-level backstop against two
-- OVERLAPPING duties for the same crew ever being committed concurrently — the
-- kind of race a pure application check can lose under load.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE crew_duties (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  crew_id       uuid NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  -- trip_id is filled once scheduling exists (Part 5); nullable until then.
  trip_id       uuid,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  driving_minutes integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'assigned', -- 'assigned' | 'completed' | 'cancelled'
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_duty_time_valid CHECK (ends_at > starts_at),
  -- Backstop: no two active duties for the same crew may overlap in time.
  -- Requires btree_gist (enabled in migration 0001).
  CONSTRAINT crew_duty_no_overlap EXCLUDE USING gist (
    crew_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'assigned')
);
CREATE INDEX crew_duties_crew_idx ON crew_duties (crew_id, starts_at);
CREATE INDEX crew_duties_trip_idx ON crew_duties (trip_id) WHERE trip_id IS NOT NULL;

-- Apply tenant isolation.
SELECT apply_tenant_rls('vehicles');
SELECT apply_tenant_rls('vehicle_documents');
SELECT apply_tenant_rls('maintenance_logs');
SELECT apply_tenant_rls('fuel_logs');
SELECT apply_tenant_rls('crew');
SELECT apply_tenant_rls('crew_duties');

COMMENT ON CONSTRAINT vehicles_tenant_id_registration_no_key ON vehicles IS 'A vehicle with this registration already exists';
COMMENT ON CONSTRAINT crew_duty_no_overlap ON crew_duties IS 'Crew is already assigned to an overlapping duty';

-- migrate:down

DROP TABLE IF EXISTS crew_duties;
DROP TABLE IF EXISTS crew;
DROP TYPE IF EXISTS crew_status;
DROP TYPE IF EXISTS crew_role;
DROP TABLE IF EXISTS fuel_logs;
DROP TABLE IF EXISTS maintenance_logs;
DROP TABLE IF EXISTS vehicle_documents;
DROP TABLE IF EXISTS vehicles;
DROP TYPE IF EXISTS vehicle_status;
