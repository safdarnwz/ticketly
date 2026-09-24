-- =============================================================================
-- 0058_trip_waitlist
-- Passengers waiting on a FULL trip segment. When seats free up (a
-- cancellation), waiting entries are notified oldest-first, only as many as
-- the freed seats can satisfy. A notification is not a reservation.
-- =============================================================================

-- migrate:up
CREATE TABLE trip_waitlist (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_stop_id   uuid NOT NULL REFERENCES stops(id),
  to_stop_id     uuid NOT NULL REFERENCES stops(id),
  from_seq       smallint NOT NULL,
  to_seq         smallint NOT NULL CHECK (to_seq > from_seq),
  seat_count     smallint NOT NULL CHECK (seat_count BETWEEN 1 AND 6),
  contact_phone  text NOT NULL,
  contact_email  text,
  customer_id    uuid REFERENCES users(id),
  status         text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'cancelled', 'expired')),
  notified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One live entry per phone per trip (re-joining updates nothing; leave first).
CREATE UNIQUE INDEX trip_waitlist_one_live_uq ON trip_waitlist (trip_id, contact_phone) WHERE status = 'waiting';
CREATE INDEX trip_waitlist_queue_idx ON trip_waitlist (trip_id, created_at) WHERE status = 'waiting';
SELECT apply_tenant_rls('trip_waitlist');

-- Notification template for every EXISTING operator (new operators get it
-- from onboarding defaults; seeds insert their own).
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'waitlist.seats_available', 'sms', NULL,
       'Good news! {{seatCount}} seat(s) just opened up on {{routeName}} ({{journeyDate}}). Book quickly — seats go to whoever books first: {{bookUrl}}'
  FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

-- migrate:down
DELETE FROM notification_templates WHERE event_type = 'waitlist.seats_available';
DROP TABLE IF EXISTS trip_waitlist;
