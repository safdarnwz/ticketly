-- =============================================================================
-- 0054_seat_quotas
--
-- Seats of a trip reserved for ONE agent or branch (Bitla-style allocation).
-- The seat is blocked in trip_seats.blocked_legs with `mask` (all bits, so it
-- is independent of stop numbering); only its holder can book it (the quota
-- is "consumed" and the bits cleared in the same transaction as the hold).
-- At release_at (= departure − chosen minutes) an unsold quota seat returns to
-- general sale automatically (worker: releaseDue).
-- =============================================================================

-- migrate:up
CREATE TABLE seat_quotas (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id             uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_number         text NOT NULL,
  holder_type         text NOT NULL CHECK (holder_type IN ('agent', 'branch')),
  holder_id           uuid NOT NULL,
  mask                bigint NOT NULL,
  release_at          timestamptz NOT NULL,
  released_at         timestamptz,
  release_reason      text,
  consumed_at         timestamptz,
  consumed_booking_id uuid REFERENCES bookings(id),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seat_quotas_single_outcome CHECK (released_at IS NULL OR consumed_at IS NULL)
);
-- One LIVE allocation per seat; history (released / consumed) is kept.
CREATE UNIQUE INDEX seat_quotas_live_uq ON seat_quotas (trip_id, seat_number) WHERE released_at IS NULL AND consumed_at IS NULL;
CREATE INDEX seat_quotas_due_idx ON seat_quotas (release_at) WHERE released_at IS NULL AND consumed_at IS NULL;
CREATE INDEX seat_quotas_holder_idx ON seat_quotas (tenant_id, holder_type, holder_id) WHERE released_at IS NULL AND consumed_at IS NULL;
SELECT apply_tenant_rls('seat_quotas');

-- migrate:down
DROP TABLE IF EXISTS seat_quotas;
