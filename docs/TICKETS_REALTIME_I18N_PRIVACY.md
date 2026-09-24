# Part 15 — Signed Tickets, Realtime SSE, i18n/Multi-currency, Privacy (DPDP)

The final platform layer: what the traveller carries (a verifiable ticket), sees
live (seat availability), reads (their language, their currency) and controls
(their personal data). Plus the delivery scaffolding — seeds, an e2e suite, and a
client SDK. Same house style: **pure, exhaustively tested domain cores** wrapped
by thin services, in the DDD layered layout.

---

## 1. Signed ticket QR (`modules/tickets`)

Each confirmed seat gets a compact token `<payload>.<sig>` — the QR content —
where the signature is an **HMAC-SHA256** over the payload under a key
domain-separated from the platform secret. The conductor app scans it and
verifies **offline** at the gate: a forged or edited ticket (changed seat,
changed trip, replayed after expiry) fails without any network call.

`domain/ticket-token.ts` is pure: it builds a stable signing input (fixed key
order), encodes/decodes, checks expiry, and verifies against an
already-computed signature in **constant time**. The HMAC itself is computed in
the service via `@security` (`hmacSha256`), so the key never touches the domain.
A printable HTML e-ticket carries the tokens.

`GET /v1/bookings/:id/tickets` · `GET /v1/bookings/:id/ticket.html` · `POST /v1/tickets/verify`

## 2. Realtime seat availability (`modules/realtime`)

The storefront opens `GET /v1/realtime/trips/:tripId/seats` (SSE) and receives
`seat.update` events as seats are taken/freed — no polling. `domain/sse.ts` is
pure: spec-correct SSE framing (per-line `data:` prefix, blank-line terminator)
and a `seatDelta` that diffs available-seat sets so only the change is pushed.
Per-trip streams; at scale the fan-in is Redis-pub/sub-backed (the interface is
identical to the in-process path).

## 3. i18n & multi-currency (`modules/i18n`)

Per-tenant translation catalogs with a fallback chain (requested locale → base
language → `en`) and `{placeholder}` interpolation (`domain/translator.ts`), and
on-the-fly currency conversion at the operator's quoted rate. Conversion is
**integer-minor and rounding-explicit** (`domain/currency.ts`) — rates are passed
as micro-units (×1e6), minor scales differ per currency (INR/USD=2, JPY=0,
KWD=3), and the final unit is half-up rounded, so a displayed foreign price never
invents or loses a sub-unit. Deterministic formatting (western + Indian grouping).

`GET /v1/i18n/convert` · `POST /v1/i18n/translations` · `POST /v1/i18n/fx-rates`

## 4. Privacy / DPDP (`modules/privacy`)

India's DPDP Act, 2023, modelled honestly:

- **Consent** (`domain/consent.ts`) — an append-only log; current state is the
  latest event per purpose. Necessary purposes (`transactional`) are a legitimate
  use and always allowed; withdrawing one is refused.
- **Erasure** (`domain/retention.ts`) — the right to be forgotten. Financial
  records (invoices, ledger) are legally retained, so erasure **anonymises** PII
  (redacts contact fields on bookings/passengers/users) rather than deleting,
  inside one transaction. Retention deadlines + `redactPii` are pure.

`POST /v1/privacy/consents` · `GET /v1/privacy/consents` ·
`POST /v1/privacy/erasure-requests` · `POST /v1/privacy/erasure-requests/:id/process`

## 5. Seeds, e2e & SDK

- **Seeds** (`db/seeds/`) — `permissions` (the full catalogue), `roles` (system
  templates owner/manager/finance/ops/support + grants), `platform` (plans),
  `demo` (a clickable operator). All idempotent; verified to apply (and re-apply)
  against the migrated schema.
- **E2E** (`test/e2e/`) — the purchase flow (search→quote→hold→confirm→ticket,
  incl. the anti-double-sell refusal) and DPDP flows, against the real Nest app +
  Postgres (rolled back per file).
- **SDK** (`libs/sdk/`) — a dependency-free, typed `fetch` client that carries the
  bearer + tenant + idempotency headers and parses the RFC-9457 error envelope.

## Migration

`db/migrations/0015_tickets_i18n_privacy.sql` — `translations`, `fx_rates`,
`consents`, `erasure_requests` (all tenant-scoped, RLS). Signed ticket tokens are
stateless, so they need no table.

## Verification

- 362 TypeScript files parse cleanly; 643 intra-repo imports resolve.
- 306 domain unit tests pass — including the 6 new pure engines (ticket-token,
  currency, translator, consent, retention, sse), each with happy / positive /
  negative / edge cases.
- 15/15 migrations apply and round-trip; all 4 seed files apply idempotently
  (30 permissions, 5 roles, owner=all, 3 plans, demo tenant); the erasure
  anonymisation SQL is verified valid against the live schema.
