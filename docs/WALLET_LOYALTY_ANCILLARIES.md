# Wallet, Loyalty, Referrals & Ancillaries (Part 12)

Customer engagement and value-added revenue. Two pure engines (points, wallet)
are tested for happy/negative/edge; both balances are append-only ledgers so
they can't drift or be double-spent.

## Customer wallet

Refundable store credit as a **per-customer append-only ledger** — the balance
is `sum(amount_minor)`, never a mutable field. A **debit runs under a row lock**
(`SELECT … FOR UPDATE` on the customer's entries), recomputes the balance, and
refuses an overdraft: a wallet is store credit, never a credit line. So two
concurrent spends serialise and the wallet can never go negative. A cancellation
refund can be credited to the wallet **instantly** (no gateway round-trip), and
`splitPayment` uses wallet-first then gateway-for-the-rest (the two always sum to
the total).

## Loyalty points

Points earned on confirmed **net** fare (pre-tax, post-discount — you don't
reward GST or an un-taken discount), scaled by the customer's tier. Redemption is
bounded by balance, a per-fare cap and the whole-point quantum, under a row lock
so the same points can't be spent twice; the discount always equals
`points × burnValue`. Tiers (Blue→Silver→Gold→Platinum) raise the earn
multiplier — the loyalty flywheel. Points are a ledger too: balance =
`sum(points)`, lifetime = positive earn/referral. Earning is driven by
`booking.confirmed` events in the worker (idempotent — skips a booking already
earned for), so the booking module never knew about loyalty.

15 points tests + 12 wallet tests cover tier boundaries, flooring, per-fare caps,
overdraft rejection, and the payment split summing exactly.

## Referrals

A deterministic per-customer code; a new customer using it at signup creates a
`referrals` row, and the referrer earns reward points when the referee completes
their **first booking** — settled idempotently (one reward per referral) in the
same worker handler.

## Ancillary add-ons

Operator catalogue of insurance / meals / extra luggage / priority boarding.
Passengers attach add-ons to a booking; the unit price is **captured at purchase
time** on `booking_ancillaries`, so a later catalogue price change never rewrites
what was charged. The total folds into the payment.

> Note: buses have **no waitlist / RAC** — that is a railway concept, and it is
> not part of this platform. A sold-out segment simply shows no availability.
