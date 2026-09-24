# Master Data — Geography, Routes & Seat Layouts (Part 3)

The reference data every later part reads on the hot path. Two pieces carry
real domain complexity and are therefore modelled as pure, self-validating
value objects with exhaustive tests: the **seat map** and the **route path**.

## Geography (shared)

`countries → states → cities`, plus operator-owned **stops** (boarding/dropping
points). Cities are shared platform data so an OTA can search
"Hyderabad → Chennai" across operators with one vocabulary. City autocomplete
uses a **trigram index** (`pg_trgm`), not `LIKE '%q%'` — so it stays fast and
index-backed as the catalogue grows, and matches aliases ("Bangalore" /
"Bengaluru", "Bhagyanagar" → Hyderabad).

## Seat layouts — the canonical seat map

A bus layout is the fiddliest master data in the system and everything
downstream depends on it: inventory allocates one availability bit per seat,
pricing can price by seat/deck/position, the booking UI renders a clickable
grid, the manifest lists passengers by seat. So it is an **immutable,
self-validating value object** (`SeatMap`). Construction *guarantees*:

- unique seat numbers;
- no two seats occupy the same `(deck,row,column)` cell (overlap detection
  across multi-cell sleeper berths);
- coordinates within the declared grid;
- derived counts (seater/sleeper/ladies/bookable) — never trusted from input.

Coordinate system is UI-agnostic (logical grid, not pixels): `deck` 0/1,
0-based `row` front→back, 0-based `column` left→right with the aisle as a gap. A
sleeper berth spans two rows (`rowSpan: 2`). An invalid layout throws a 422 with
a precise message, so the designer gives immediate feedback and a broken layout
can never be persisted or served. Tested across happy, negative and edge cases
(single-seat minibus, adjacent-but-not-overlapping berths, grid overflow,
duplicate numbers, phantom decks).

## Routes — ordered stops, derived timing, segments

A route is an ordered list of stops. Each stop stores only its **raw inputs**:
sequence, running distance from origin, departure offset (minutes after start),
dwell, and board/alight flags. The `RoutePath` model **derives** everything else
on read — arrival clock-times, day-offsets, totals — so nothing can drift into a
stale column. Hand-entered day-offsets are the classic "arrives yesterday" bug;
here they are computed.

The model's second job is enumerating **segments**: every bookable
`(origin, destination)` pair. A 4-stop route A→B→C→D yields 6 segments. This is
the foundation the **segment-wise inventory engine** (Part 5) stands on — a seat
sold A→C blocks A-B, A-C and B-C but stays free for C-D. Board-only and
alight-only stops (pickup/technical stops) are respected when generating
segments. Validation rejects non-monotonic distance/time, gapped sequences, a
non-zero origin offset, and negative dwell — all covered by tests.

## Vehicle types & amenities

Vehicle types (AC Sleeper, Non-AC Seater …) bind a default seat layout and an
amenity set; actual vehicles (Part 4) reference these. Amenities are an
operator-curated catalogue.

## Caching

Cities, seat layouts and published routes are read on every search and every
trip materialisation, so their repositories are cache-backed with a long TTL and
invalidated on write — L1 (in-process) in front of L2 (Redis), with the
stampede protection from Part 1.

## Isolation

Every operator-owned table (stops, amenities, seat_layouts, vehicle_types,
routes, route_stops) carries the standard tenant RLS policy. Verified: bound to
one operator, queries return only that operator's stops and routes; another
operator sees zero.
