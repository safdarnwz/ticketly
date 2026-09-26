-- =============================================================================
-- 0094_booking_booked_by
--
-- A counter sale recorded the staff member as the booking's CUSTOMER — so staff
-- showed up in the customer list and could act as the passenger (review the
-- trip, cancel as "owner"). Record the seller separately; the customer of a
-- counter sale is the passenger's mobile, not a staff account. Existing counter
-- bookings made by staff are moved over.
-- =============================================================================

-- migrate:up
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booked_by uuid REFERENCES users(id);

UPDATE bookings b SET booked_by = b.customer_id, customer_id = NULL
  FROM users u
 WHERE u.id = b.customer_id AND u.kind = 'staff';

CREATE INDEX IF NOT EXISTS bookings_booked_by_idx ON bookings (tenant_id, booked_by, created_at)
  WHERE booked_by IS NOT NULL;

-- migrate:down
UPDATE bookings SET customer_id = booked_by WHERE booked_by IS NOT NULL AND customer_id IS NULL;
DROP INDEX IF EXISTS bookings_booked_by_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS booked_by;
