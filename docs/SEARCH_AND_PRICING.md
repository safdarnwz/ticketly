# Search & Dynamic Pricing (Part 6)

The revenue engine: how a passenger finds a trip fast, and how its price is
computed exactly and auditably.

## Pricing engine (pure, 18 tests)

`PricingEngine.price()` turns inputs into a fully-decomposed `FareBreakup`.
Deterministic → the same inputs always yield the same price, which is what makes
a quote trustworthy and testable. The pipeline, in order:

```
base
 → dynamic yield  (occupancy ladder × advance-purchase curve, clamped)
 → coupon         (percent or flat, capped, min-fare gated)
 → GST            (CGST+SGST intra-state, or IGST inter-state)
= total
```

Everything is `Money` (integer minor units), so the identity
`total == net + taxes` holds to the paisa at every step — asserted by tests,
including odd-amount GST splits and stacked yield+coupon combinations.

Design choices proven by tests: yield multipliers apply to the **base** (not
compounded), so each rule's contribution is independently auditable and a
stacked set can't explode a fare; the ceiling (`maxMultiplier`) is enforced; a
flat coupon is split across seats with **no paisa lost** (`priceMany`); a
percentage coupon respects its `maxDiscount` cap and `minFare` gate; and a flat
coupon never drives the fare below zero.

## Dynamic pricing / yield

Occupancy ladder ("at 80% full, ×1.25") and advance-purchase curve ("within 1
day, ×1.4") combine to a single multiplier, clamped to `[min, max]`. Stored per
route (or a tenant default) as jsonb, cache-backed. This is standard airline-
style yield management adapted to buses: fill early cheaply, capture urgency
late, never exceed a ceiling that would look like gouging.

## Fare resolution

A segment's base fare is looked up as: exact `(from, to, seat_type)` rule →
per-km fallback rule → none. So an operator can define a precise fare matrix or
just a per-km rate, and search prices either way. Fares and policies are served
from cache (long TTL, invalidated on write), so pricing adds no DB round trip on
a cache hit.

## Quotes — price integrity across the booking gap

A passenger sees a price, then spends two minutes entering details; by payment
time the occupancy (and dynamic price) may have moved. `PricingService.quote()`
pins the price into a short-lived (3 min) **quote**, cached by id. Booking
(Part 7) re-validates the quote and refuses a stale one rather than silently
charging a different amount. Quotes are cached, not stored — they evaporate on
expiry with zero cleanup.

## Coupons — race-safe redemption

`validateAndLoad` checks validity window and redemption cap; `redeem` bumps the
usage counter with a **conditional** `UPDATE … WHERE usage_count < max_redemptions`,
so two concurrent bookings can never push a limited coupon past its cap (the
classic "last coupon sold twice" race). Redemption happens inside the booking
transaction (Part 7).

## Search — the sub-10ms hot path

The most-hit endpoint on any bus platform. Engineered for latency at every
layer:

1. **Route shortlist** — one indexed query (`routes_od_idx`) for published
   routes matching the origin/destination city.
2. **Trips** — one indexed query (`trips_search_idx`) for open trips on those
   routes for the date, on a replica.
3. **Availability** — **one** aggregate for all trips at once via the leg-bitmap
   (`availableCountForTrips`), not a query per trip.
4. **Pricing** — the pure engine with cache-served fares/policies; no DB hit on
   a cache hit.
5. **Whole result cached** for a few seconds with single-flight, so a burst of
   identical searches collapses to one compute.

Cached availability is display-only; the authoritative seat lock is at booking
time (Part 7).
