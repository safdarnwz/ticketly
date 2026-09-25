-- =============================================================================
-- 0085_booking_seat_count_repair
--
-- Cancelling some seats of a booking removed them but left the booking's
-- seat_count as it was, so occupancy, the bookings list and the dashboard
-- counted seats that were already given back. Bring every live booking's
-- count back in line with its seats (the code now keeps it in step).
-- =============================================================================

-- migrate:up
UPDATE bookings b
   SET seat_count = s.n, updated_at = now()
  FROM (SELECT booking_id, count(*)::int AS n FROM booking_seats GROUP BY booking_id) s
 WHERE s.booking_id = b.id
   AND b.status IN ('held', 'confirmed', 'completed')
   AND b.seat_count <> s.n;

-- migrate:down
-- Nothing to undo: the old counts were wrong.
SELECT 1;
