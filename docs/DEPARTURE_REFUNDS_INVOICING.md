# Part 13 — Departure Control, Refund Lifecycle & GST e-Invoicing

This part closes three financial-integrity gaps in the platform: what actually
happened on the bus at departure, what happens to a customer's money after a
cancellation, and the tax document the sale legally requires. All three are
built the same way the rest of the platform is — a **pure, exhaustively tested
domain core** wrapped by thin repositories and services, every rupee moving as a
**balanced double-entry ledger** posting, and every write **idempotent** because
the outbox delivers at-least-once.

> Buses have **no waitlist / RAC** (a railway concept). Nothing in this part
> reintroduces it.

---

## 1. Departure control (trip charting)

At departure the conductor "charts" the trip: the system reconciles the live
seat position against what actually boarded, and the declared cash against what
onboard/spot sales *should* have collected, then writes an immutable closeout
record.

**Pure engine — `departure-control/domain/chart-reconciliation.ts`**

```
expected boarded = confirmed tickets covering the departure leg
no-shows         = confirmed − boarded
vacant seats     = capacity − confirmed − spot sales     (resellable)
cash variance    = declared − (expected spot fare × spot count)   (+surplus / −shortage)
```

The engine validates its inputs (no negative counts, confirmed ≤ capacity,
boarded ≤ confirmed + spot sales) and never silently accepts a cash mismatch —
a shortage is surfaced at closeout, not discovered in a month-end audit.

**Persistence — `trip_charts`** (one row per trip, `UNIQUE (trip_id)`): charting
a trip twice is refused (`DCS.ALREADY_CHARTED`) so the closeout figure can never
be overwritten. Seat counts are read live from `tickets` + `trips`, so a chart
always reflects the true position at charting time.

**API**

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/trips/:tripId/chart` | `trip:operate` | Chart at departure (seat + cash reconcile) |
| `GET`  | `/v1/trips/:tripId/chart` | `trip:operate` | Read the closeout record |

---

## 2. Refund lifecycle

A refund is a small **state machine**, not a single event — encoding the legal
transitions makes impossible states (a settled refund going back to processing,
a failed one silently marked settled) unrepresentable.

```
initiated ──▶ processing ──▶ settled
    │             │
    │             └──▶ failed ──▶ processing   (retry)
    └──▶ cancelled                └──▶ manual   (paid outside the gateway)
```

**Two destinations** (`refund-state.ts`):

- **Wallet** — instant. Credit the customer's append-only wallet ledger, post
  the `refund.paid` ledger entry, and settle, all in one transaction. No gateway.
- **Source** — through the PSP. Call `gateway.refund`, record the gateway refund
  id, leave the refund `processing`; the gateway's async webhook later drives
  `reconcileGatewayEvent` → `settled` (posts the ledger) or `failed`.

**Balanced clawback — `refund-clawback.ts`** (pure, 8 tests). A (possibly
partial) refund is reversed out of the **same** accounts it was booked into, in
the **same** proportion, so:

```
commissionClawback + operatorClawback === refundMinor      (always foots)
```

Rounding is absorbed into the operator leg, guaranteeing the `refund.paid` entry
balances to the paisa — the ledger can never drift on a refund.

**Idempotency**: initiating a refund for a booking that already has a live one
returns the existing refund (no double-refund); a duplicate gateway webhook for
an already-settled refund is a no-op.

**API**

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/bookings/:bookingId/refunds` | `payment:read`   | List refunds |
| `POST` | `/v1/refunds`                    | `payment:refund` | Initiate (source/wallet) |
| `POST` | `/v1/refunds/reconcile`          | `payment:refund` | Reconcile a gateway callback |
| `POST` | `/v1/refunds/:id/retry`          | `payment:refund` | Retry a failed source refund |
| `POST` | `/v1/refunds/:id/manual`         | `payment:refund` | Record an off-gateway payout |

**Automatic**: the worker's `RefundHandler` initiates a refund-to-source on
`booking.cancelled` (skipping non-refundable, zero-amount cancellations).

---

## 3. GST tax invoicing

**Pure tax maths — `invoicing/domain/gst-invoice.ts`**. Given line items and
whether the supply is inter-state, it produces the split:

- **Intra-state** → CGST + SGST (half each)
- **Inter-state** → IGST (full)

with a rounding line so `taxable + tax + roundOff === total` exactly.

**Gapless numbering — `invoice-number.ts` + `invoice_series`**. GST requires a
unique, gapless sequence per financial year (Apr–Mar). The number
(`INV/2026-27/000123`) is allocated by an atomic `UPSERT … RETURNING` on
`invoice_series`, so two concurrent issuances can never collide or leave a gap
(verified 1→2→3 under real Postgres).

**Documents — `invoices`**. A tax invoice (`kind='tax'`, SAC 9964) is raised on
confirmation; a **credit note** (`kind='credit'`, negative amounts, referencing
the original) on cancellation. Both are idempotent — one tax invoice and at most
one credit note per booking, regardless of at-least-once delivery.

**API**

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/bookings/:bookingId/invoices` | `payment:read`      | List invoices/credit notes |
| `POST` | `/v1/invoices`                     | `settlement:manage` | Issue a tax invoice on demand |

**Automatic**: the worker's `InvoiceHandler` issues the tax invoice on
`booking.confirmed` and the credit note on `booking.cancelled`.

---

## Event wiring (worker)

```
booking.confirmed ─▶ InvoiceHandler.issueForBooking      (tax invoice)
booking.cancelled ─┬▶ InvoiceHandler.creditNoteForBooking (credit note)
                   └▶ RefundHandler.initiate             (refund-to-source)
```

Living in the worker (not the booking flow) keeps invoicing and refunds
**bolt-ons the booking module never knew about** — the whole point of the
event-driven design.

## Migration

`db/migrations/0013_dcs_refunds_invoicing.sql` — adds `trip_charts`,
`invoice_series`, `invoices`; extends `refunds` with `destination`,
`reconciled_at`, `failure_reason`, `cancellation_id`. All tenant-scoped tables
carry Row-Level Security via `apply_tenant_rls(...)`.

## Verification

- **277** TypeScript files parse cleanly.
- **225** domain unit tests pass (GST split, invoice numbering, refund state
  machine, refund clawback, chart reconciliation — happy / positive / negative /
  edge for each).
- **13/13** migrations apply and round-trip; gapless invoice sequence and the
  refund lifecycle columns verified functionally against real PostgreSQL 16.
