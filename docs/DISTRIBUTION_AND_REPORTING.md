# OTA Distribution, Reporting & Deploy (Part 10)

The final layer: let third parties sell the inventory, let operators measure it,
and ship the whole thing without Docker.

## OTA / GDS distribution API (`modules/gds`)

The redBus/Paytm-style integration surface. There is **one** partner API: the
GDS. (An older per-operator "distribution" API keyed with `X-Api-Key` sold only
one operator's seats and duplicated the same flow; it was removed and its
webhooks moved to `modules/webhooks`.)

A GDS partner (an OTA or a multi-operator agent) is onboarded by the platform
admin, authenticates with `X-GDS-Key`, and sells every operator that has
switched distribution to it on, at the commission each operator sets. Partners
are prepaid (deposit) or postpaid (credit limit) against a partner ledger.

- Partner API (`/v1/gds`): `GET account`, `POST search`,
  `GET trips/:tripId/seats?from=&to=`, `POST bookings` (block), `POST
  bookings/:id/confirm`, `POST bookings/:id/cancel`, `GET bookings/:id`.
- Platform admin (`/v1/admin/gds/partners`): onboarding, status, terms,
  receipts, API keys, and the partner's webhook endpoint
  (`GET|PUT|DELETE :id/webhook`, `POST :id/webhook/test`).
- Operator (`/v1/gds-partners`, `/v1/trips/:tripId/closed-channels`): which
  partners may sell, at what commission, and channel-wise sales per trip.

The controllers are thin adapters over the same internal services the
first-party storefront uses (search, pricing, booking), so partners get
identical inventory, pricing and the anti-double-sell guarantee. Booking
endpoints are `@Idempotent()` (partners retry hard) and rate-limited.

**Webhooks** (`modules/webhooks`) are one implementation for operators
(`/v1/webhooks`) and GDS partners: signed with HMAC-SHA256 over the raw body,
retried with backoff, every attempt logged, and a signed test event on demand.

## Reporting / BI

Heavy analytics are pre-aggregated into **materialized views** (`mv_trip_daily`,
`mv_operator_revenue_daily`, `mv_route_performance`) refreshed by the worker with
`REFRESH ... CONCURRENTLY` (never blocks reads). A dashboard query is then a
small indexed lookup, not a live scan of bookings/ledger. Revenue, occupancy and
route-performance endpoints plus a CSV export are provided; every query filters
by the ambient tenant and reads a replica.

## Observability

Structured logging (pino, request-context on every line), Prometheus metrics
(RED + DB pool + cache + domain counters, cardinality-safe), and OpenTelemetry
tracing (bootstrapped before any instrumented module loads). `/health/live`,
`/ready`, `/startup` separate liveness from readiness so a DB blip can't trigger
a restart storm.

## Architecture tests

`test/architecture` enforces platform invariants at build time — e.g. **every
money/inventory mutation must be `@Idempotent()`**. A missing decorator fails the
build, not code review. Verified passing: hold, confirm, cancel and payment
intent all carry it.

## No-Docker deployment

Runs on Node 22 + PostgreSQL 16 via **systemd** (templated units for N API
instances + workers) or **PM2** (`deploy/ecosystem.config.cjs`), behind
**nginx** (TLS, health-aware load balancing) with **PgBouncer** transaction
pooling and tuned **postgresql.conf**. Graceful shutdown (drain → wait → close)
gives zero-downtime rolling deploys. **k6** load tests encode the SLOs as
thresholds (search p99 < 120ms, confirm p99 < 400ms) and gate CI. Full guides in
`DEPLOYMENT.md`, `PERFORMANCE.md`, `FEATURE_DEVELOPMENT.md` and `RUNBOOK.md`.

**Critical deploy requirement:** the app connects as a `NOSUPERUSER NOBYPASSRLS`
role (`db/roles.sql`) — a superuser connection would silently bypass every
tenant-isolation policy.
