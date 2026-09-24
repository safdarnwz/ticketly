-- =============================================================================
-- 0007_booking
--
-- Bookings, per-seat allocation, passengers, tickets, and cancellations. This
-- is the transactional heart that consumes the segment-wise inventory from
-- Part 5 under a row lock — the authoritative gate against double-selling a
-- seat on any leg.
-- =============================================================================

-- migrate:up

CREATE TYPE booking_status AS ENUM
  ('pending', 'held', 'confirmed', 'completed', 'cancelled', 'expired', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- bookings — one per purchase. `pnr` is the human reference. A held booking
-- carries `hold_expires_at`; the sweeper (Part 9) expires stale holds and frees
-- their seats.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pnr               text NOT NULL,
  trip_id           uuid NOT NULL REFERENCES trips(id),
  route_id          uuid NOT NULL REFERENCES routes(id),
  -- The booked segment (stop sequences) — every seat in the booking shares it.
  from_seq          smallint NOT NULL,
  to_seq            smallint NOT NULL,
  from_stop_id      uuid NOT NULL REFERENCES stops(id),
  to_stop_id        uuid NOT NULL REFERENCES stops(id),
  channel           text NOT NULL DEFAULT 'direct_web',
  status            booking_status NOT NULL DEFAULT 'pending',
  -- Contact + billing.
  customer_id       uuid REFERENCES users(id),
  contact_email     text,
  contact_phone     text,
  seat_count        smallint NOT NULL,
  -- Money, all integer minor units. `total` = fare + tax - discount.
  currency          char(3) NOT NULL DEFAULT 'INR',
  base_minor        bigint NOT NULL DEFAULT 0,
  discount_minor    bigint NOT NULL DEFAULT 0,
  tax_minor         bigint NOT NULL DEFAULT 0,
  total_minor       bigint NOT NULL DEFAULT 0,
  paid_minor        bigint NOT NULL DEFAULT 0,
  coupon_code       text,
  quote_id          text,
  fare_breakup      jsonb,
  hold_expires_at   timestamptz,
  confirmed_at      timestamptz,
  cancelled_at      timestamptz,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- PNR is unique per tenant.
  UNIQUE (tenant_id, pnr)
);
CREATE INDEX bookings_trip_idx ON bookings (trip_id, status);
CREATE INDEX bookings_customer_idx ON bookings (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
-- Sweeper predicate: held bookings past their expiry.
CREATE INDEX bookings_hold_expiry_idx ON bookings (hold_expires_at) WHERE status = 'held';
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_seats — the seats a booking holds. `leg_mask` is the segment bitmask
-- (Part 5), stored so a hold/confirm/cancel can OR/AND it into trip_seats and so
-- the hold-overlap check is a bitwise test. One (trip, seat) can appear in many
-- bookings (different, non-overlapping segments) — that is the coexistence
-- property — so the uniqueness is on (booking, seat), not (trip, seat).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE booking_seats (
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id       uuid NOT NULL REFERENCES trips(id),
  seat_number   text NOT NULL,
  leg_mask      bigint NOT NULL,
  fare_minor    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (booking_id, seat_number)
);
-- Supports the active-hold overlap check by (trip, seat).
CREATE INDEX booking_seats_trip_seat_idx ON booking_seats (trip_id, seat_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- passengers — one per seat. Name/age/gender for the manifest and for
-- ladies-only enforcement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE passengers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seat_number   text NOT NULL,
  full_name     text NOT NULL,
  age           smallint,
  gender        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passengers_booking_idx ON passengers (booking_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- tickets — issued at confirmation, one per seat. `boarding_code` is the QR
-- payload validated at boarding (Part 9). `boarded_at` records the scan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tickets (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  trip_id       uuid NOT NULL REFERENCES trips(id),
  seat_number   text NOT NULL,
  passenger_id  uuid REFERENCES passengers(id),
  boarding_code text NOT NULL,
  status        text NOT NULL DEFAULT 'valid',  -- 'valid' | 'boarded' | 'cancelled'
  boarded_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, boarding_code)
);
CREATE INDEX tickets_booking_idx ON tickets (booking_id);
CREATE INDEX tickets_trip_idx ON tickets (trip_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- cancellations — an audit + refund record. The actual refund money movement
-- happens in Part 8; this records the policy computation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cancellations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  reason          text,
  refund_pct      smallint NOT NULL,
  paid_minor      bigint NOT NULL,
  fee_minor       bigint NOT NULL DEFAULT 0,
  refund_minor    bigint NOT NULL,
  cancelled_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cancellations_booking_idx ON cancellations (booking_id);

SELECT apply_tenant_rls('bookings');
SELECT apply_tenant_rls('booking_seats');
SELECT apply_tenant_rls('passengers');
SELECT apply_tenant_rls('tickets');
SELECT apply_tenant_rls('cancellations');

COMMENT ON CONSTRAINT bookings_tenant_id_pnr_key ON bookings IS 'PNR collision — retry generation';

-- migrate:down

DROP TABLE IF EXISTS cancellations;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS passengers;
DROP TABLE IF EXISTS booking_seats;
DROP TABLE IF EXISTS bookings;
DROP TYPE IF EXISTS booking_status;
