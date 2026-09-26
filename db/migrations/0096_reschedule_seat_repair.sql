-- =============================================================================
-- 0096_reschedule_seat_repair
--
-- A reschedule moved booking_seats to the new bus/seats but left passengers
-- and tickets on the old ones: the chart showed the passenger in the old seat,
-- the new seat looked free while its inventory was taken, and the ticket's
-- trip was still the old bus (boarding scans on the new bus failed). The code
-- now moves them together; this repairs bookings already affected by pairing
-- the stale seats with the unmatched new ones in seat order.
-- =============================================================================

-- migrate:up
WITH stale AS (
  SELECT p.booking_id, p.seat_number AS from_seat,
         row_number() OVER (PARTITION BY p.booking_id ORDER BY p.seat_number) AS n
    FROM passengers p JOIN bookings b ON b.id = p.booking_id
   WHERE NOT EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.booking_id = p.booking_id AND bs.seat_number = p.seat_number)
), fresh AS (
  SELECT bs.booking_id, bs.seat_number AS to_seat,
         row_number() OVER (PARTITION BY bs.booking_id ORDER BY bs.seat_number) AS n
    FROM booking_seats bs
   WHERE NOT EXISTS (SELECT 1 FROM passengers p WHERE p.booking_id = bs.booking_id AND p.seat_number = bs.seat_number)
), pairs AS (
  SELECT s.booking_id, s.from_seat, f.to_seat FROM stale s JOIN fresh f USING (booking_id, n)
)
UPDATE passengers p SET seat_number = pairs.to_seat
  FROM pairs WHERE p.booking_id = pairs.booking_id AND p.seat_number = pairs.from_seat;

-- Tickets: onto the booking's trip and the seat the passenger now holds.
UPDATE tickets t SET boarding_code = t.boarding_code || ':' || t.id
  FROM bookings b
 WHERE b.id = t.booking_id AND t.status <> 'cancelled'
   AND (t.trip_id <> b.trip_id OR NOT EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.booking_id = t.booking_id AND bs.seat_number = t.seat_number));

WITH stale AS (
  SELECT t.id, t.booking_id, row_number() OVER (PARTITION BY t.booking_id ORDER BY t.seat_number) AS n
    FROM tickets t
   WHERE t.status <> 'cancelled' AND t.boarding_code LIKE '%:' || t.id::text
), fresh AS (
  SELECT bs.booking_id, bs.seat_number, row_number() OVER (PARTITION BY bs.booking_id ORDER BY bs.seat_number) AS n
    FROM booking_seats bs
   WHERE NOT EXISTS (SELECT 1 FROM tickets t2 WHERE t2.booking_id = bs.booking_id AND t2.seat_number = bs.seat_number
                       AND t2.boarding_code NOT LIKE '%:' || t2.id::text)
)
UPDATE tickets t SET trip_id = b.trip_id, seat_number = f.seat_number, boarding_code = b.pnr || '-' || f.seat_number
  FROM stale s JOIN fresh f USING (booking_id, n) JOIN bookings b ON b.id = s.booking_id
 WHERE t.id = s.id;

-- migrate:down
SELECT 1;
