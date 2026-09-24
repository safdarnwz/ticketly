# Scheduling & Segment-wise Inventory (Part 5)

The heart of the platform. Two pure engines carry the difficulty and are proven
by tests (happy, negative, edge) and — for inventory — end-to-end in real SQL.

## Segment-wise inventory — the leg-bitmap

The problem that makes a bus GDS harder than it looks: **one seat can be sold to
different passengers on different parts of the same trip.** On A → B → C → D, a
seat sold A→C must be unavailable for A-B, A-C and B-C, yet still bookable — to
*someone else* — for C-D. Get it wrong and you either double-sell a seat or
refuse a booking you could have taken.

The model represents each seat's occupancy on a trip as a **bitmask over the
route's legs** (a route with N stops has N-1 legs). Booking segment `[from,to)`
ORs in the bits for those legs. Availability is a single bitwise AND:

```
seat free for (from,to)  ⇔  occupied_legs & segment_mask(from,to) == 0
```

`occupied_legs` and `blocked_legs` (operator quota/holds) are native Postgres
`bigint` columns, and `segment_mask()` is a SQL function mirroring the domain
model — so **"seats free on A→C" is one indexed aggregate with a bitwise AND**,
not a per-seat loop. That is what keeps search fast. BigInt in the domain keeps
it correct up to 62 legs.

Verified end-to-end in PostgreSQL: seat 1 booked A→C leaves C→D showing full
availability; the *same* seat is then booked C→D (coexistence), and both
segments' counts track correctly. The domain model has 14 tests including the
coexistence property, double-booking rejection, release, and >53-bit routes.

## Recurrence — services → trips

A **service** is a recurring template ("20:30 Hyderabad→Chennai, daily except
festivals, Apr–Sep"). The recurrence engine (RRULE-inspired, deliberately
simpler than full iCalendar) supports daily/weekly frequency, weekday sets,
N-period intervals, a validity window, per-date **exceptions** (skip) and
**additions** (one-off extra runs). 16 tests cover intervals, exception-beats-
addition, boundaries, and invalid rules.

**Materialisation** expands the rule over a rolling horizon (default 120 days)
and creates dated **trips**, computing each stop's absolute instant from the
journey date + service start minute + origin timezone (DST-correct). Each trip:

- **snapshots its stop timetable** from the route, so a later route edit cannot
  rewrite a trip that already has tickets sold against it;
- initialises one inventory row per bookable seat from the seat layout;
- checks the default vehicle is **road-legal on that date** (Part 4) and leaves
  it unassigned rather than binding an uninsured bus.

Each trip is created in one unit of work (atomic), and the unique
`(service_id, journey_date)` constraint makes re-runs idempotent — the daily job
only ever inserts the delta.

## Trip lifecycle & blocks

Trips move `scheduled → open → departed → closed`, or `cancelled`. Operators can
**block/unblock** seats on any segment (quota management) using the same bitmap
(`blocked_legs`). Availability treats blocked and occupied identically.

## What is authoritative where

The availability read model runs on replicas and is for search/display. It is
NOT the gate against double-selling — that is the row-locked seat occupancy
update at booking time (Part 7), on the primary, which re-checks
`occupied_legs & mask = 0` under `FOR UPDATE`. Two layers, same bitmap algebra.
