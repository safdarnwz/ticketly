-- =============================================================================
-- 0040_journey_connections
--
-- Connecting-journey support (e.g. Delhi -> Kolkata on Operator A, then
-- Kolkata -> Bhubaneswar on Operator B, when no single operator runs
-- Delhi -> Bhubaneswar directly). Two bookings, POTENTIALLY two different
-- tenants — bookings/routes/stops are all tenant-scoped (migration 0002/
-- 0003/0007), so "the same city" is two DIFFERENT stop rows across two
-- operators, and there is no single tenant this link could live under
-- without violating the other tenant's RLS isolation.
--
-- This table is therefore PLATFORM-LEVEL — no tenant_id, no RLS (same
-- pattern as platform_legal_pages/announcements) — it only ever stores
-- IDs and a status, never fare/passenger detail (that stays on each leg's
-- own tenant-scoped booking row, exactly where it already is).
-- =============================================================================

-- migrate:up

CREATE TYPE journey_connection_status AS ENUM ('active', 'leg1_cancelled', 'leg2_cancelled', 'both_cancelled');

CREATE TABLE journey_connections (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id         uuid REFERENCES users(id),
  leg1_tenant_id      uuid NOT NULL REFERENCES tenants(id),
  leg1_booking_id     uuid NOT NULL,
  leg2_tenant_id      uuid NOT NULL REFERENCES tenants(id),
  leg2_booking_id     uuid NOT NULL,
  -- The city both legs meet at — a city, not a stop, since each operator's
  -- own stop row for "the same city" is a different UUID. Layover is
  -- computed at search/hold time from each leg's own trip timing and
  -- snapshotted here for display — never re-derived from live trip state
  -- later, so a subsequent delay on either leg doesn't retroactively
  -- rewrite what the customer was shown and agreed to at booking time.
  connection_city_id  uuid NOT NULL REFERENCES cities(id),
  layover_minutes     integer NOT NULL,
  status              journey_connection_status NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journey_connection_legs_distinct CHECK (leg1_booking_id <> leg2_booking_id)
);
CREATE INDEX journey_connections_leg1_idx ON journey_connections (leg1_tenant_id, leg1_booking_id);
CREATE INDEX journey_connections_leg2_idx ON journey_connections (leg2_tenant_id, leg2_booking_id);
CREATE INDEX journey_connections_customer_idx ON journey_connections (customer_id);

-- migrate:down

DROP TABLE IF EXISTS journey_connections;
DROP TYPE IF EXISTS journey_connection_status;
