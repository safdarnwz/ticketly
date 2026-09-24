# Master Plan — 10 Parts

The platform is delivered in ten self-contained parts. Each part is independently
reviewable, builds on the ones before it, and ends in a compiling, testable state.
This document is the contract for what each part contains, so nothing is missed.

---

## Part 1 — Platform Foundation & Core Kernel  ✅ (this drop)

The substrate. Everything else is built on it.

- Monorepo, TypeScript strict, path aliases, build/lint/test tooling.
- **Kernel** (pure, no infra): branded UUID-v7 ids, `Money` (integer minor units),
  timezone-correct date/time model, `Result<T,E>`, domain-event / entity / aggregate /
  value-object primitives, request-context (AsyncLocalStorage), retry with jitter,
  single-flight, keyset pagination, guards, error kernel + error codes.
- **Config**: zod-validated environment, typed `AppConfig` facade.
- **Database**: pg pooling with type-parser overrides, read-replica routing with
  lag-aware failover, unit of work (savepoints, auto-retry on 40001), RLS tenant binding,
  hand-SQL composition helpers, `BaseRepository`, checksum-tracked migrator, health probe.
- **Cache**: L1 (in-process LRU) + L2 (Redis) with single-flight, stale-while-revalidate,
  cross-instance pub/sub invalidation, distributed locks.
- **HTTP**: RFC 9457 error filter, request-context middleware, metrics/timeout/
  serialization interceptors, **idempotency** (Stripe-style), **sliding-window rate
  limiting**, zod validation pipe, Swagger/OpenAPI.
- **Observability**: pino structured logging, Prometheus metrics, OpenTelemetry tracing.
- **Messaging**: domain-event bus writing to a **transactional outbox**.
- **Apps**: API (Fastify) + worker skeleton, graceful shutdown, health/readiness, metrics.
- Migration `0001`: uuid-v7 generator, outbox (monthly-partitioned), idempotency store.

## Part 2 — Multi-Tenancy, IAM, Auth & Audit

- Tenant (operator) aggregate; provisioning workflow; suspension/quotas.
- Tenant resolution (host / subdomain / header / token) → RLS binding.
- Users, roles, **RBAC + ABAC**; permission catalogue enforcement.
- JWT access/refresh with rotation, sessions & revocation, OTP login, API keys for OTAs.
- Plans, feature flags, per-tenant quotas.
- Append-only audit log; `@security` lib (argon2 hashing, AES-256-GCM PII encryption).
- Migrations: tenants, users, roles, permissions, sessions, api_keys, audit_log; RLS
  policies enabled on all tenant tables.

## Part 3 — Master Data, Geography, Routes & Seat Layouts

- Geography hierarchy (country → state → city), stops & boarding/dropping points.
- Routes with ordered stops/legs, distances, durations, day-offsets.
- Amenities, vehicle types, and the **seat-layout designer** (decks, rows, aisles,
  berths, sleeper/seater, coordinates) with a canonical seat-map model.
- Aggressive master-data caching + explicit invalidation.

## Part 4 — Fleet, Documents & Crew

- Vehicles bound to types & layouts; registration, ownership.
- **Document expiry engine**: permit, insurance, fitness, PUC — with proactive
  "expiring soon" events.
- Maintenance & fuel logs. Drivers/conductors, licences, duty roster & crew assignment
  with conflict detection.

## Part 5 — Scheduling & Segment-wise Inventory Engine

- Services (recurring templates) with **RRULE-style** calendars + exceptions.
- **Trip materialisation** over a rolling horizon.
- **Segment-wise seat inventory**: the heart of the system — a seat sold on
  A→B must free correctly on B→C; boarding/dropping-point pairs; bitmap availability
  model for O(1) reads.
- Blocks, quotas (per boarding point / channel), trip lifecycle (open → departed →
  closed → cancelled), and the **ultra-fast availability read model**.

## Part 6 — Search & Dynamic Pricing Engine

- Sub-10 ms **search** across services for an (origin, destination, date) with live
  availability and fare, fully cache-backed.
- **Fare rules engine**: base fares per segment, class, day-of-week, season.
- **Dynamic pricing / yield**: occupancy-based ladders, advance-purchase curves,
  demand multipliers; coupons/discounts; GST/tax computation; auditable fare breakup.

## Part 7 — Booking, PNR, Cancellation & Reschedule

- Seat **hold/lock** (advisory locks + hold TTL), the **booking saga**, idempotent
  confirmation, PNR/ticket issuance, passenger records.
- Full booking state machine; **reschedule** & seat change; **cancellation & refund
  rules** by time-to-departure; boarding QR issue & validation.

## Part 8 — Payments, Refunds, Ledger & Settlement

- Gateway **abstraction** + adapters (Razorpay/PayU-style), payment intents, signed
  **webhooks**, idempotent capture.
- **Double-entry ledger**, operator wallet, refunds, chargebacks.
- Commissions, **settlements** to operators, invoices, and reconciliation reports.

## Part 9 — Live Ops, GPS Tracking, Crew APIs & Notifications

- High-throughput **GPS ingestion** (partitioned telemetry), live position, ETA,
  geofenced boarding-point arrival, live trip status.
- **Crew/driver app APIs**: manifest, boarding scan, trip start/stop.
- **Notification engine**: SMS/Email/WhatsApp/Push provider abstraction, event-driven
  templates; the **outbox dispatcher**, schedulers, and job runners in the worker.

## Part 10 — OTA Distribution, Reporting/BI, Observability & Deploy

- **OTA/GDS distribution API** (partner auth, inventory & fare feeds, book/cancel,
  webhook catalogue) — the redBus/Paytm-style integration surface.
- **Reporting/BI**: materialised views, occupancy/revenue/settlement analytics, exports.
- Full **OpenTelemetry** wiring, dashboards, **k6 load tests**, performance playbook.
- Security hardening, **no-Docker deployment** (systemd units / PM2), CI/CD, DB tuning,
  runbooks, and the **feature-development guide**.

---

## Cross-cutting guarantees maintained in every part

1. Multi-tenant isolation (RLS + app scope) on every new table.
2. UUID v7 keys, integer-minor-unit money, timezone-correct dates.
3. Money-moving / seat-consuming endpoints are idempotent.
4. State changes and their domain events are written in one transaction (outbox).
5. Hot reads are cache-backed; writes go to the primary inside a unit of work.
6. Every feature ships with migrations, tests, and OpenAPI docs.
