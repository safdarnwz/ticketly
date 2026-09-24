# Booking Amendments (Part 11)

Completes the booking lifecycle: a passenger can change the date/trip or the
seats of a confirmed booking. The reschedule money math is a pure engine tested
for happy/negative/edge cases.

> Note: buses have no waitlist / RAC (that is a railway concept). A sold-out
> segment simply shows no availability; there is no queue.

## Reschedule (date / trip change)

Rescheduling is distinct from cancel-and-rebook: the seat moves to the new trip
in one operation and the passenger pays only the **difference plus a reschedule
fee** — they don't lose the original fare to a cancellation slab. The money math
is a single net figure so the fee is never double-counted:

```
net       = (newFare − originalFare) + rescheduleFee
amountDue = max(0, net)      // payable
refundDue = max(0, −net)     // rare: much cheaper new trip
```

The reschedule fee is tiered by hours-to-departure; rescheduling is capped
(default 2×) and forbidden inside a cutoff window. 12 tests cover pricier/cheaper
trips, the fee netting against a small reduction, tier boundaries, the cutoff and
the reschedule cap.

**The operation reuses the exact same `SeatLockRepository` gate as a fresh
booking** — it locks the new seats (row lock + bitmap + hold-overlap check),
commits their occupancy, then releases the old seats, all in one transaction. So
a reschedule can no more double-sell the target seat than a booking can. The
money delta is recorded on `booking_amendments` for audit/dispute.

## Seat change

Change seats within the same trip and segment (window instead of aisle). Same
lock-new → release-old flow; seat count must be unchanged.
