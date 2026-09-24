# OTA Distribution, Reporting & Deploy (Part 10)

The final layer: let third parties sell the inventory, let operators measure it,
and ship the whole thing without Docker.

## OTA / channel-partner distribution API

The redBus/Paytm-style integration surface. A partner authenticates with an
**API key** (Part 2, `X-Api-Key`) whose scopes gate access and whose tenant the
auth guard resolves — so a partner is always scoped to the one operator that
issued its key.

The controller is a **thin adapter over the exact same internal services** the
first-party storefront uses (`SearchService`, `PricingService`, `BookingService`).
Partners therefore get identical inventory, identical pricing, and the identical
anti-double-sell guarantee — there is no separate, drifting "partner" code path.
Booking endpoints are `@Idempotent()` (partners retry hard) and rate-limited per
key. The generated **OpenAPI spec** is the integration contract; the
`@messaging` event catalogue is the **webhook** contract (webhooks are signed —
HMAC over the raw body — exactly like the inbound PSP webhooks).

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
