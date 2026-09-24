-- =============================================================================
-- 0005_scheduling_and_inventory
--
-- The heart of the platform: recurring SERVICES, the dated TRIPS materialised
-- from them, and the SEGMENT-WISE seat inventory that lets one seat be sold to
-- different passengers on different legs of the same trip.
--
-- Inventory representation (see domain/segment-inventory.ts):
--   Each (trip, seat) row holds `occupied_legs` — a bigint bitmask over the
--   route's legs. Booking a segment [from,to) ORs in the mask for those legs;
--   a seat is available for a segment iff `occupied_legs & segment_mask = 0`.
--   `blocked_legs` is the same idea for operator holds/quotas. Because these are
--   native bigint columns, "seats free on A→C" is ONE indexed aggregate with a
--   bitwise AND — no per-seat loop, which is what keeps search fast.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- services — the recurring template. The recurrence rule is jsonb (frequency,
-- weekdays, interval, window, exceptions, additions) validated by the
-- Recurrence domain model. start_time is minutes-since-midnight at the origin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE service_status AS ENUM ('draft', 'active', 'paused', 'ended');

CREATE TABLE services (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              text NOT NULL,
  route_id          uuid NOT NULL REFERENCES routes(id),
  vehicle_type_id   uuid NOT NULL REFERENCES vehicle_types(id),
  -- Preferred vehicle; scheduling may reassign. NULL = assign at materialisation.
  default_vehicle_id uuid REFERENCES vehicles(id),
  start_minute      smallint NOT NULL,          -- 0..1439, origin departure
  recurrence        jsonb NOT NULL,             -- RecurrenceRule
  status            service_status NOT NULL DEFAULT 'draft',
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX services_tenant_status_idx ON services (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX services_route_idx ON services (route_id) WHERE deleted_at IS NULL;
CREATE TRIGGER services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- trips — one dated instance of a service. `journey_date` is a calendar day
-- (the date at the ORIGIN); `departs_at` is the derived absolute instant, used
-- for booking cut-off and sorting. `stop_count` sizes the segment bitmap.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE trip_status AS ENUM ('scheduled', 'open', 'departed', 'closed', 'cancelled');

CREATE TABLE trips (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  route_id          uuid NOT NULL REFERENCES routes(id),
  vehicle_id        uuid REFERENCES vehicles(id),
  seat_layout_id    uuid NOT NULL REFERENCES seat_layouts(id),
  journey_date      date NOT NULL,
  departs_at        timestamptz NOT NULL,
  arrives_at        timestamptz NOT NULL,
  stop_count        smallint NOT NULL,
  total_seats       smallint NOT NULL,
  status            trip_status NOT NULL DEFAULT 'scheduled',
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- A service runs at most once per calendar date.
  UNIQUE (service_id, journey_date)
);
-- The search hot-path predicate: a tenant's open trips on a route for a date.
CREATE INDEX trips_search_idx ON trips (tenant_id, route_id, journey_date, status);
CREATE INDEX trips_departure_idx ON trips (tenant_id, departs_at) WHERE status IN ('scheduled','open');
CREATE INDEX trips_service_date_idx ON trips (service_id, journey_date);
CREATE TRIGGER trips_updated_at BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- trip_stops — the trip's concrete stop sequence with absolute clock times.
-- Snapshotted from the route at materialisation so a later route edit does not
-- retroactively change already-sold trips (a critical correctness property:
-- passengers hold tickets against the timetable that existed when they booked).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trip_stops (
  trip_id       uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence      smallint NOT NULL,
  stop_id       uuid NOT NULL REFERENCES stops(id),
  arrives_at    timestamptz NOT NULL,
  departs_at    timestamptz NOT NULL,
  can_board     boolean NOT NULL DEFAULT true,
  can_alight    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (trip_id, sequence)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- trip_seats — THE inventory. One row per seat per trip.
--   occupied_legs : bitmask of legs sold (see segment-inventory.ts)
--   blocked_legs  : bitmask of legs the operator has blocked (quota/hold)
-- A seat is available for a segment mask M iff
--   (occupied_legs | blocked_legs) & M = 0   AND is_bookable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trip_seats (
  trip_id       uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seat_number   text NOT NULL,
  seat_type     text NOT NULL,
  is_bookable   boolean NOT NULL DEFAULT true,
  ladies_only   boolean NOT NULL DEFAULT false,
  occupied_legs bigint NOT NULL DEFAULT 0,
  blocked_legs  bigint NOT NULL DEFAULT 0,
  version       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (trip_id, seat_number)
);
-- Partial index over seats that still have free capacity, so availability
-- aggregates skip fully-sold seats.
CREATE INDEX trip_seats_available_idx ON trip_seats (trip_id)
  WHERE is_bookable AND (occupied_legs | blocked_legs) <> -1;

-- ─────────────────────────────────────────────────────────────────────────────
-- A SQL helper for the segment mask: legs [from,to). Mirrors the domain model
-- so availability can be computed inside the database in one pass.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION segment_mask(from_seq integer, to_seq integer)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ((1::bigint << to_seq) - 1) # ((1::bigint << from_seq) - 1);
$$;

-- Count available seats on a trip for a given segment, in one indexed pass.
CREATE OR REPLACE FUNCTION trip_available_seats(p_trip_id uuid, from_seq integer, to_seq integer)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer
    FROM trip_seats
   WHERE trip_id = p_trip_id
     AND is_bookable
     AND ((occupied_legs | blocked_legs) & segment_mask(from_seq, to_seq)) = 0;
$$;

SELECT apply_tenant_rls('services');
SELECT apply_tenant_rls('trips');
SELECT apply_tenant_rls('trip_stops');
SELECT apply_tenant_rls('trip_seats');

COMMENT ON CONSTRAINT services_tenant_id_code_key ON services IS 'A service with this code already exists';

-- migrate:down

DROP FUNCTION IF EXISTS trip_available_seats(uuid, integer, integer);
DROP FUNCTION IF EXISTS segment_mask(integer, integer);
DROP TABLE IF EXISTS trip_seats;
DROP TABLE IF EXISTS trip_stops;
DROP TABLE IF EXISTS trips;
DROP TYPE IF EXISTS trip_status;
DROP TABLE IF EXISTS services;
DROP TYPE IF EXISTS service_status;
