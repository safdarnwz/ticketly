-- =============================================================================
-- 0031_full_platform_completion
--
-- Batch of genuinely-missing pieces from the full feature checklist:
--   - stops.pincode
--   - coupon targeting flags (first-booking-only, agent-only)
--   - customer CRM: blacklist + preferences on users
--   - counter cash-shift open/close (reconciliation)
--   - platform-wide announcements (super-admin broadcast)
--   - seat-upgrade audit trail (seater→sleeper, differential fare)
-- =============================================================================

-- migrate:up

ALTER TABLE stops ADD COLUMN pincode text;

ALTER TABLE coupons ADD COLUMN first_booking_only boolean NOT NULL DEFAULT false;
ALTER TABLE coupons ADD COLUMN agent_only boolean NOT NULL DEFAULT false;
ALTER TABLE coupons ADD COLUMN description text;

-- Customer CRM. `users` already holds every customer (kind='customer') — this
-- just adds the operator-facing controls the checklist calls for. A blocked
-- customer can still be LOOKED UP (support needs to see their history) but
-- can never hold a NEW booking — enforced in BookingService.hold.
ALTER TABLE users ADD COLUMN blacklisted_at timestamptz;
ALTER TABLE users ADD COLUMN blacklist_reason text;
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE counter_shifts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id),
  opened_by       uuid NOT NULL REFERENCES users(id),
  opening_cash_minor bigint NOT NULL DEFAULT 0,
  closed_by       uuid REFERENCES users(id),
  closing_cash_minor bigint,
  -- Snapshot at close time: sum of counter-cash bookings during the shift window, for reconciliation against the physical cash count.
  expected_cash_minor bigint,
  status          text NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  notes           text
);
CREATE INDEX counter_shifts_tenant_status_idx ON counter_shifts (tenant_id, status);
SELECT apply_tenant_rls('counter_shifts');

-- Platform-wide broadcast — super-admin only, shown to operators (and
-- optionally customers) until it expires. Deliberately simple: no per-tenant
-- targeting for v1, just an on/off banner with a severity level.
CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  title           text NOT NULL,
  body            text NOT NULL,
  severity        text NOT NULL DEFAULT 'info',   -- 'info' | 'warning' | 'critical'
  audience        text NOT NULL DEFAULT 'operators', -- 'operators' | 'customers' | 'all'
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- No RLS — platform-wide, not tenant-scoped by design (super-admin manages, everyone reads).

-- Seat-upgrade audit — when a passenger upgrades seater→sleeper (or similar)
-- before a cut-off time, this is the paper trail: original/new seat, the
-- differential fare charged (with its own GST), same PNR throughout.
CREATE TABLE seat_upgrades (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  ticket_id         uuid NOT NULL REFERENCES tickets(id),
  from_seat_number  text NOT NULL,
  to_seat_number    text NOT NULL,
  from_seat_type    text NOT NULL,
  to_seat_type      text NOT NULL,
  differential_fare_minor bigint NOT NULL,
  differential_tax_minor  bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('seat_upgrades');

-- Fleet: photo + free-text service-history note (checklist: "Bus photo/metadata", "Bus service history note").
ALTER TABLE vehicles ADD COLUMN photo_url text;
ALTER TABLE vehicles ADD COLUMN service_note text;

-- Trip reminders: track whether the 6-hour-before-departure reminder has
-- already been sent, so the scheduler's periodic sweep never double-sends.
ALTER TABLE trips ADD COLUMN reminder_sent_at timestamptz;

-- migrate:down

ALTER TABLE trips DROP COLUMN IF EXISTS reminder_sent_at;

ALTER TABLE vehicles DROP COLUMN IF EXISTS service_note;
ALTER TABLE vehicles DROP COLUMN IF EXISTS photo_url;
DROP TABLE IF EXISTS seat_upgrades;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS counter_shifts;
ALTER TABLE users DROP COLUMN IF EXISTS preferences;
ALTER TABLE users DROP COLUMN IF EXISTS blacklist_reason;
ALTER TABLE users DROP COLUMN IF EXISTS blacklisted_at;
ALTER TABLE coupons DROP COLUMN IF EXISTS description;
ALTER TABLE coupons DROP COLUMN IF EXISTS agent_only;
ALTER TABLE coupons DROP COLUMN IF EXISTS first_booking_only;
ALTER TABLE stops DROP COLUMN IF EXISTS pincode;
