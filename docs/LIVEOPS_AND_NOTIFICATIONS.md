# Live Ops, GPS Tracking, Crew APIs & Notifications (Part 9)

The operational layer, plus the worker machinery that makes the whole
event-driven design actually deliver. The geo math is pure and tested; the
outbox concurrency is proven against real PostgreSQL.

## The outbox dispatcher — reliable event delivery

This is the other half of the transactional-outbox pattern (Part 1 writes events
inside the business transaction; this drains them) and the reason "on
booking.confirmed, send a WhatsApp / notify the OTA / update analytics" happens
reliably without the booking transaction ever calling those systems.

- **FOR UPDATE SKIP LOCKED** claim: locks a batch of pending rows and skips ones
  a sibling worker holds, so **N workers drain concurrently with zero
  coordination and zero double-processing**. Verified in real PostgreSQL: two
  workers claiming simultaneously got completely disjoint sets.
- **At-least-once** (not exactly-once): a crash between handling and marking
  delivered can re-deliver, so every handler is idempotent (the notification log
  de-dupes on `(event, channel, recipient)`).
- **Exponential backoff + dead-letter**: a failing event retries with growing
  delay; after the max attempts it moves to `dead` so one poison event can't
  block the queue — dead events are alerted, never silently dropped.
- Runs in the **worker process**, so a slow SMS provider never touches the
  request event loop.

## Schedulers

Periodic jobs, each guarded by a Redis distributed lock so exactly one worker
replica runs it: the **seat-hold sweeper** (expire holds past TTL, free
inventory — the counterpart to Part 7's hold), **partition maintenance** (create
next-period partitions for outbox/audit/gps ahead of need), **idempotency
purge**, and **outbox requeue**.

## GPS tracking

`gps_pings` is the highest-write-rate table (a 500-bus fleet at 1 ping/5s ≈ 100
writes/s), so it is **day-partitioned, append-only** (old partitions dropped,
never DELETEd) and indexed only by `(trip, recorded_at)`. Ingestion writes the
raw ping plus an UPSERT of the trip's single `trip_live` row with the derived
**next-stop ETA and delay** — the live map reads that one cheap row, never the
heavy table. A material delay emits `trip.delayed`, which the notification
handler turns into passenger alerts.

The geo math (`haversineMeters`, `isWithin` geofence, `etaSeconds`,
`nextStopEta`, `bearingDegrees`) is pure and covered by 15 tests including a
known intercity distance, geofence boundaries, stopped-bus ETA floor, and the
next-stop transition.

## Crew / driver app

- **Manifest** — the confirmed passenger list per trip (seat, name, O/D).
- **Boarding scan** — validate a ticket's boarding code and mark boarded.
  Idempotent (re-scan returns state), and anti-forgery: a code for a different
  trip or a non-confirmed booking is rejected. Emits `passenger.boarded`.
- **Trip start/stop** — the driver flips operational status, feeding tracking.

## Notification engine

Event → the tenant's active templates per channel → rendered (a safe
`{{placeholder}}` substituter with no code execution — templates are
operator-editable and must never be an injection vector) → dispatched via a
per-channel **provider** (SMS/email/WhatsApp/push behind one interface; adding a
provider is one adapter). Every send is logged with a unique constraint on
`(event, channel, recipient)` so a retried outbox delivery never double-sends —
the idempotency the dispatcher requires.

This is the payoff of the event-driven design: adding "notify on confirmation"
touched only the notification handler; the booking module never knew.
