# Payments, Refunds, Ledger & Settlement (Part 8)

The money layer. Two pure engines (double-entry ledger, commission) are tested
for happy/negative/edge; the ledger balance backstop and webhook signature
verification are proven against real PostgreSQL and real crypto.

## Double-entry ledger (the financial source of truth, 12 tests)

Every rupee that moves is recorded as a **balanced** set of postings: the sum of
debits always equals the sum of credits. This is the only representation that
lets you prove, at any instant, that money was neither created nor destroyed,
and reconcile against a PSP to the paisa. Postings are signed integer minor
units (+ debit, − credit); a transaction is valid iff Σ = 0, guarded by
`LedgerTransaction.create` — an unbalanced entry can never be constructed.

Standard entries are defined once (`captureEntry`, `refundEntry`,
`settlementEntry`) so the accounting is reviewed once, not re-derived per call
site. A capture splits gateway money into operator payable, platform commission
and tax; a refund reverses proportionally; a settlement moves payable to wallet.

**Defence in depth:** a **deferred constraint trigger** in Postgres re-checks the
balance at COMMIT and refuses an unbalanced entry. Verified: a balanced entry
commits, an unbalanced one is rejected at COMMIT. And the **trial balance** —
the sum across all accounts — is always zero in a correct system; the endpoint
surfaces it as the single most important thing to monitor.

## Payment gateway abstraction

The flow speaks only to a `PaymentGateway` interface (create intent, verify
webhook, refund); each PSP (Razorpay, PayU, Cashfree…) is a small adapter.
Adding one is a single provider binding — no booking/payment code changes.

**The webhook is the source of truth for money, not the client callback.** A
client can lie; a signed server-to-server webhook cannot. Every adapter:

- verifies the PSP signature **over the raw body** (HMAC-SHA256, constant-time
  compare) — a webhook whose signature doesn't verify is discarded. Verified
  against real crypto: valid passes, tampered body fails, missing signature
  fails.
- is idempotent on our intent id (never two PSP orders per intent).

Webhooks are deduplicated on the PSP event id (`ON CONFLICT DO NOTHING`), giving
**exactly-once effect over at-least-once delivery**. On `captured`, one
transaction confirms the booking (Part 7 seat commit + tickets) and posts the
ledger capture — money and inventory move together or not at all.

## Commission (pure, 7 tests)

Per-operator/route config: percent, flat-per-ticket, or percent-plus, with an
optional cap. Charged on the net (pre-tax) fare — GST is a pass-through, never
commissionable. Never exceeds the net fare.

## Refunds & settlement

A cancellation's refund (computed by Part 7's time-to-departure policy) is paid
through the gateway's `refund` and recorded as a `refundEntry` reversing the
operator/commission split. **Settlements** are computed straight from the ledger
(so they always reconcile with the books, not a parallel sum of bookings);
finalising posts `settlement.paid`, moving `operator_payable → operator_wallet`
and keeping the trial balance at zero.
