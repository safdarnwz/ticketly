# Booking, PNR, Cancellation & Reschedule (Part 7)

The transactional core that ties search, pricing and inventory into a purchase.
Two pure engines (refund policy, state machine) are tested for happy/negative/
edge; the concurrency-critical seat gate is verified end-to-end against real
PostgreSQL with two racing transactions.

## The anti-double-sell gate (the most important code in the platform)

Every seat sale funnels through `SeatLockRepository.lockSeats`, which runs
INSIDE the booking transaction and, in order:

1. `SELECT … FOR UPDATE` the requested `trip_seats` rows (deterministic order to
   avoid deadlocks). This takes a **row lock**, so two concurrent buyers of the
   same seat **serialise** — the second blocks until the first commits. This
   turns check-then-write (a classic TOCTOU race) into an atomic operation.
2. Bitmap check: `(occupied_legs | blocked_legs) & segmentMask == 0` — free on
   every leg of the requested segment, using the exact algebra from Part 5.
3. Active-hold overlap check: no other `held`, unexpired booking overlaps the
   segment on the same seat.

**Verified in real PostgreSQL:** two transactions race for one seat; the second
blocks on the lock, then sees the first's sale and its conditional UPDATE
affects **0 rows** — refused. Final state: the seat is sold exactly once. The
double-sell race is impossible by construction, not by hope.

## The booking saga

Each step is one unit of work — atomic, and (for the mutating endpoints)
idempotent via the Part-1 idempotency layer:

- **HOLD** — re-validate the price **quote** (Part 6) so the passenger can't be
  charged a moved price; lock the seats (the gate above); write a `held` booking
  with a TTL. No money moves. Emits `booking.seats_held`.
- **CONFIRM** — re-lock the booking, check the hold hasn't expired and the paid
  amount covers the total, **atomically redeem the coupon** (Part 6's conditional
  update, so a capped coupon can't oversell), OR the seat masks into
  `occupied_legs` (commit the sale), issue the **PNR + tickets**, mark
  `confirmed`. A confirm on an already-confirmed booking **replays** cleanly.
  Emits `booking.confirmed`.
- **CANCEL** — validate the transition, compute the refund from the time-to-
  departure policy, **release** the seat occupancy, record the cancellation.
  Emits `booking.cancelled`.

The seat-hold **sweeper** (Part 9) expires stale holds and frees their inventory.

## Refund policy (pure, 15 tests)

Tiered by hours-to-departure (e.g. >24h → 90%, 6–24h → 75%, 2–6h → 50%, <2h →
0%), with an optional flat fee and hard cutoff. Money-exact (integer minor
units) so a refund is reproducible and a dispute is settled by re-running it.
Tested edges: tier boundaries are inclusive of the higher tier, the fee never
drives a refund negative, post-departure yields nothing, and percentages round
to the paisa.

## Booking state machine (pure, 12 tests)

`pending → held → confirmed → completed`, with `held → expired/cancelled` and
`confirmed → cancelled`. Illegal transitions (confirm a cancelled booking, skip
`held`, revive an expired hold) are impossible to express. Predicates
(`isTerminal`, `holdsInventory`, `isCancellable`) drive the service.

## PNR

Six characters from a 28-symbol alphabet with ambiguous characters removed
(no 0/O, 1/I/L) — readable, non-sequential, non-enumerable. A unique index on
`(tenant, pnr)` is the guarantee; the service retries generation on the rare
clash, each attempt in a **savepoint** so a collision doesn't poison the booking
transaction.

## Tickets & boarding

Confirmation issues one ticket per seat with a `boarding_code` (the QR payload).
Boarding validation (scan → mark boarded) is wired in Part 9's crew app.
