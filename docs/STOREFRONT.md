# Part 14 — Storefront: Filters, Round-Trip / Connecting, Reviews, Support, CMS, Fraud

The traveller-facing layer on top of the reservation core. Five modules, each
built the house way — a **pure, exhaustively tested domain core** wrapped by thin
services/repositories, tenant-scoped with Row-Level Security, and camelCase-clean
TypeScript over snake_case Postgres.

---

## 1. Journey search (`modules/search`)

One search module serves every surface (storefront, agent console, GDS
partners); there is no separate storefront search any more. It refines raw trip
search (Part 6) into what a traveller needs:

- **Filtered + sorted results** — `domain/result-filter.ts` filters by price band,
  departure wall-clock window (`departAfter`/`departBefore`), seat type (any-match),
  amenities (all-match), operator rating and seats-needed, then sorts by
  price / departure / duration / rating with a **stable** tie-break (rating defaults
  to best-first). Pure, 10 tests.
- **Round trip** — one call returns matching onward + return legs.
- **Connecting journeys** — `domain/connecting-journey.ts` pairs an A→hub leg with a
  hub→B leg only when they meet at the same hub, the layover is within
  `[min, max]` (default 2–24 h), and the second departs after the first arrives.
  Combined duration is honest door-to-door (includes the layover); bottleneck seat
  count is reported. Sorted by total duration then price. Pure, 7 tests.
  Booking a connecting journey is `modules/connections` (one hold + one payment
  across both legs).

`POST /v1/search`, `POST /v1/search/round-trip`, `POST /v1/search/connecting`
(`application/services/journey-search.service.ts`).

## 2. Reviews & ratings (`modules/reviews`)

**Verified reviews only** — you can review a booking you actually travelled
(confirmed/completed) and that is yours; one review per booking (DB-unique).
`domain/rating-aggregate.ts` returns the plain **average** (what users see) and a
**Bayesian** score (what ranking sorts by) so a handful of 5★ don't outrank a
high-volume 4.7★. Pure, 11 tests.

`POST /v1/reviews`, `GET /v1/routes/:routeId/reviews` (summary + list).

## 3. Support tickets (`modules/support`)

Tickets with an append-only message thread and a small state machine
(`domain/ticket-state.ts`): `open ⇄ pending → resolved → closed`. A reply moves the
ticket by author — a customer reply reopens it, an agent reply on an open ticket
sends it to pending — and explicit status changes are validated against the legal
transitions. Reply + status change commit in one transaction. Pure, 11 tests.

`POST /v1/support/tickets`, `GET /v1/support/tickets[/:id]`,
`POST /v1/support/tickets/:id/messages`, `POST /v1/support/tickets/:id/status`.

## 4. Content: pages, legal, banners, offers, announcements (`modules/content`)

One module for everything the platform publishes (it replaces the former cms,
legal and announcements modules):

- **Pages** — slug-addressed, `kind` = `page` or `legal`. Every page has a
  draft/published status **and** a `version` + `effective_from` that move whenever
  the published text changes (what makes a Terms change enforceable). Legal pages
  can never be drafts.
- **Banners and offers** — surfaced only within their validity window, evaluated
  at read time, so an expired promo simply stops showing. Offers reject an
  inverted window.
- **Announcements** — for customers or operators, sorted by severity
  (critical first) within their display window.

Public: `GET /v1/content/pages[?kind=legal]`, `/content/pages/:slug`,
`/content/banners`, `/content/offers`, `/content/announcements/customers`;
`GET /content/announcements/operators` (signed in).
Platform admin: `/v1/content/admin/pages|banners|offers|uploads|announcements`.

## 5. Fraud / risk (`modules/fraud`)

`domain/risk-scorer.ts` — a transparent, rule-weighted booking risk score. Each
signal (new account, velocity, order value, bulk seats, disposable email, new
payment method, billing-country mismatch, night booking) contributes fixed,
**attributable** points; the total (capped 100) maps to a band and decision:

```
score < 40  → low     → allow
40–69       → medium  → review
score ≥ 70  → high    → deny
```

Every assessment is persisted with its reasons for audit and a manual-review queue.
The decision is advisory to the booking flow (hard-block on deny, or step-up auth).
Pure, 7 tests.

`POST /v1/fraud/assess`, `GET /v1/fraud/review-queue`, `GET /v1/fraud/bookings/:id`.

---

## Migration

`db/migrations/0014_storefront_reviews_support_cms_fraud.sql` — `reviews`,
`support_tickets`, `support_messages`, `cms_pages`, `cms_banners`, `offers`,
`fraud_assessments`. All tenant-scoped with `apply_tenant_rls(...)`.
`0074_content_pages.sql` later merged `cms_pages` and `platform_legal_pages`
into `content_pages`.

## Verification

- 330 TypeScript files parse cleanly; 599 intra-repo imports resolve.
- 257 domain unit tests pass — including the 5 new pure engines
  (result-filter, connecting-journey, rating-aggregate, ticket-state, risk-scorer),
  each with happy / positive / negative / edge cases.
- 14/14 migrations apply and round-trip against real PostgreSQL 16.
