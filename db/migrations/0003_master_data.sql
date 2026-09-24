-- =============================================================================
-- 0003_master_data
--
-- Geography (shared), and the operator-owned master data: stops, amenities,
-- vehicle types, seat layouts, routes and their ordered stops. This is the
-- reference data every later part reads on the hot path, so it is shaped for
-- fast, cache-friendly reads and protected by the same RLS policy as Part 2.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Geography — SHARED platform data (no tenant_id). Every operator references
-- the same city/stop catalogue, which is what lets an OTA (Part 10) search
-- "Hyderabad → Chennai" across operators with a common vocabulary.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE countries (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  iso2        char(2) NOT NULL UNIQUE,       -- 'IN'
  name        text    NOT NULL,
  dial_code   text    NOT NULL DEFAULT '',
  currency    char(3) NOT NULL DEFAULT 'INR',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE states (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  country_id  uuid NOT NULL REFERENCES countries(id),
  code        text NOT NULL,                 -- 'TG', 'TN'
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, code)
);

CREATE TABLE cities (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  state_id    uuid NOT NULL REFERENCES states(id),
  name        text NOT NULL,
  -- Location for distance / nearest-city queries.
  latitude    double precision,
  longitude   double precision,
  timezone    text NOT NULL DEFAULT 'Asia/Kolkata',
  -- Search aliases ("Bangalore" / "Bengaluru") for autocomplete.
  aliases     text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cities_state_idx ON cities (state_id);
-- Trigram index powers fast fuzzy city autocomplete.
CREATE INDEX cities_name_trgm_idx ON cities USING gin (name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- stops — boarding / dropping points. OPERATOR-OWNED: each operator curates its
-- own pickup/drop points within a city (their office, a landmark, a bus stand).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE stop_kind AS ENUM ('boarding', 'dropping', 'both');

CREATE TABLE stops (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  city_id     uuid NOT NULL REFERENCES cities(id),
  name        text NOT NULL,                 -- 'Miyapur (near Metro)'
  kind        stop_kind NOT NULL DEFAULT 'both',
  landmark    text,
  address     text,
  latitude    double precision,
  longitude   double precision,
  -- Contact phone shown to passengers for this pickup point.
  contact_phone text,
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX stops_tenant_city_idx ON stops (tenant_id, city_id) WHERE deleted_at IS NULL;
CREATE INDEX stops_name_trgm_idx ON stops USING gin (name gin_trgm_ops);
CREATE TRIGGER stops_updated_at BEFORE UPDATE ON stops FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- amenities — operator-owned catalogue (WiFi, charging, blanket, water …).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE amenities (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  icon        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- seat_layouts — the canonical seat map (validated by the SeatMap value object).
-- The `layout` jsonb holds decks/rows/columns/seats; derived counts are stored
-- alongside for cheap listing without parsing the whole map.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE seat_layouts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,               -- '2+1 Sleeper (36)'
  decks         smallint NOT NULL,
  total_seats   smallint NOT NULL,
  seater_count  smallint NOT NULL DEFAULT 0,
  sleeper_count smallint NOT NULL DEFAULT 0,
  layout        jsonb NOT NULL,              -- SeatMapProps
  is_active     boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, name)
);
CREATE INDEX seat_layouts_tenant_idx ON seat_layouts (tenant_id) WHERE deleted_at IS NULL;
CREATE TRIGGER seat_layouts_updated_at BEFORE UPDATE ON seat_layouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- vehicle_types — a class of bus (AC Sleeper, Non-AC Seater …) bound to a
-- default seat layout and amenity set. Actual vehicles (Part 4) reference these.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE vehicle_types (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  code            text NOT NULL,
  is_ac           boolean NOT NULL DEFAULT false,
  seat_layout_id  uuid REFERENCES seat_layouts(id),
  amenity_ids     uuid[] NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX vehicle_types_tenant_idx ON vehicle_types (tenant_id) WHERE deleted_at IS NULL;
CREATE TRIGGER vehicle_types_updated_at BEFORE UPDATE ON vehicle_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- routes + route_stops — ordered path with derived timing.
--
-- route_stops stores the RAW inputs (sequence, running distance, depart offset,
-- dwell, board/alight flags). The derived clock-times, day-offsets and the
-- segment matrix are computed by the RoutePath domain model on read — never
-- duplicated into columns that could drift.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE route_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE routes (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code           text NOT NULL,              -- 'HYD-MAA-01'
  name           text NOT NULL,              -- 'Hyderabad → Chennai'
  origin_city_id uuid NOT NULL REFERENCES cities(id),
  dest_city_id   uuid NOT NULL REFERENCES cities(id),
  status         route_status NOT NULL DEFAULT 'draft',
  -- Denormalised totals for listing; authoritative values derive from stops.
  total_distance_m integer NOT NULL DEFAULT 0,
  total_duration_min integer NOT NULL DEFAULT 0,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX routes_tenant_status_idx ON routes (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX routes_od_idx ON routes (tenant_id, origin_city_id, dest_city_id) WHERE deleted_at IS NULL;
CREATE TRIGGER routes_updated_at BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE route_stops (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id           uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id            uuid NOT NULL REFERENCES stops(id),
  sequence           smallint NOT NULL,
  distance_from_origin_m integer NOT NULL DEFAULT 0,
  depart_offset_min  integer NOT NULL DEFAULT 0,
  dwell_min          smallint NOT NULL DEFAULT 0,
  can_board          boolean NOT NULL DEFAULT true,
  can_alight         boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, sequence),
  UNIQUE (route_id, stop_id)
);
CREATE INDEX route_stops_route_idx ON route_stops (route_id, sequence);

-- Apply the standard tenant-isolation policy to every operator-owned table.
SELECT apply_tenant_rls('stops');
SELECT apply_tenant_rls('amenities');
SELECT apply_tenant_rls('seat_layouts');
SELECT apply_tenant_rls('vehicle_types');
SELECT apply_tenant_rls('routes');
SELECT apply_tenant_rls('route_stops');

-- Constraint-name → friendly message hints (surfaced as 409s by the app).
COMMENT ON CONSTRAINT routes_tenant_id_code_key ON routes IS 'A route with this code already exists';
COMMENT ON CONSTRAINT seat_layouts_tenant_id_name_key ON seat_layouts IS 'A seat layout with this name already exists';

-- migrate:down

DROP TABLE IF EXISTS route_stops;
DROP TABLE IF EXISTS routes;
DROP TYPE IF EXISTS route_status;
DROP TABLE IF EXISTS vehicle_types;
DROP TABLE IF EXISTS seat_layouts;
DROP TABLE IF EXISTS amenities;
DROP TABLE IF EXISTS stops;
DROP TYPE IF EXISTS stop_kind;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS states;
DROP TABLE IF EXISTS countries;
