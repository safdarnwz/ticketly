-- =============================================================================
-- 0011_amendments
--
-- Booking amendment history (reschedule / seat-change). Completes the booking
-- lifecycle: a passenger can change the date/trip or seats of a confirmed
-- booking, paying only the fare difference plus a reschedule fee — never losing
-- the original fare to a cancellation slab.
-- =============================================================================

-- migrate:up

-- Track how many times a booking was rescheduled (policy cap) and link chains.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS times_rescheduled smallint NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rescheduled_from uuid REFERENCES bookings(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_amendments — an audit of every change to a confirmed booking, with
-- the money delta so accounting and disputes are reproducible.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE booking_amendments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind            text NOT NULL,          -- 'reschedule'|'seat_change'|'passenger_edit'
  -- For reschedule: the new trip; for seat change: the new seats.
  new_trip_id     uuid REFERENCES trips(id),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  fee_minor       bigint NOT NULL DEFAULT 0,
  fare_diff_minor bigint NOT NULL DEFAULT 0,
  amount_due_minor bigint NOT NULL DEFAULT 0,
  refund_minor    bigint NOT NULL DEFAULT 0,
  performed_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_amendments_booking_idx ON booking_amendments (booking_id, created_at DESC);

SELECT apply_tenant_rls('booking_amendments');

-- migrate:down

DROP TABLE IF EXISTS booking_amendments;
ALTER TABLE bookings DROP COLUMN IF EXISTS rescheduled_from;
ALTER TABLE bookings DROP COLUMN IF EXISTS times_rescheduled;
