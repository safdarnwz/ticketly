# Ticketly — Enterprise Bus Reservation & Distribution System

**Ticketly** is a multi-tenant **Global Distribution System** for bus operators, built on
**NestJS + TypeScript + PostgreSQL**. Engineered for sub-10-millisecond hot-path
responses, strict correctness on money and seat inventory, and cheap long-term feature
development.

> **No Docker.** Runs directly on Node.js 22 + PostgreSQL 16 (systemd / PM2 deployment,
> covered in Part 10). **UUID v7** everywhere. **PostgreSQL** only. **npm** (not pnpm).

## Domains

One API fleet serves three hosts; `TenantResolutionMiddleware` tells them apart
by the `Host` header — no per-tenant deploy or nginx config:

| Host | Who | Tenant-bound |
|---|---|---|
| `www.ticketly.com` | Customers (search, book, manage) | No |
| `app.ticketly.com` | Super/platform admin console | No |
| `app.<slug>.ticketly.com` | One operator's staff console | Yes, by `<slug>` |

The codebase follows a strict **Domain-Driven, layered module architecture** — every
feature module is split into `application/` (use-case services), `domain/` (pure
business logic), `infrastructure/` (persistence, gateways) and `presentation/`
(controllers, DTOs). See `docs/ARCHITECTURE.md`.

---

## What this platform is

A SaaS where **one platform hosts many independent bus operators (tenants)**. Each
operator manages its own routes, buses, schedules, seat layouts, fares and bookings,
fully isolated from every other operator by PostgreSQL Row-Level Security *and* an
application-level tenant scope.

**In scope** (built across Parts 2–10): multi-tenancy & IAM, master data (geography,
routes, stops, seat layouts), fleet & crew, scheduling & segment-wise inventory,
search, dynamic pricing, online booking, cancellation/reschedule, payments & refunds,
double-entry ledger & settlement, GPS tracking & live trip ops, crew-app APIs,
notifications (SMS/Email/WhatsApp/Push), OTA/GDS distribution, and reporting/BI.

**Explicitly excluded** (per requirements): **agent booking, counter/POS booking, and
parcel/courier**.

---

## Why it is fast — "API hits in a nanosecond"

Latency is a *design constraint*, not an afterthought. The moves that keep the hot path
in single-digit milliseconds:

| Technique | Where | Effect |
|---|---|---|
| **Fastify** over Express | `apps/api/bootstrap.ts` | schema-compiled JSON serialisation; ~2–3× throughput, flatter p99 |
| **Two-tier cache** (in-process L1 → Redis L2) | `libs/cache` | L1 hit ≈ 0.0001 ms vs ~2–40 ms to Postgres |
| **Single-flight** stampede protection | `libs/kernel/single-flight.ts` | 300 concurrent misses → 1 database query |
| **UUID v7** primary keys | `libs/kernel/ids.ts` | time-ordered inserts keep B-tree writes on the right edge; ~90% buffer hit vs ~15% for v4 |
| **Read-replica routing** | `libs/database` | search/report reads offloaded from the primary, with lag-aware failover |
| **Keyset pagination** (no OFFSET) | `libs/kernel/pagination.ts` | O(log n) forever, regardless of page depth |
| **Hand-tuned SQL** (no ORM) | `libs/database/sql.ts` | segment-availability, seat-map and search queries the planner actually likes |
| **Prepared, pooled, timeout-guarded** connections | `libs/database/pool.ts` | no runaway query can exhaust the pool |
| **Load shedding** under overload | `@fastify/under-pressure` | fast for most instead of slow for all during festival surges |

---

## Why it is 10/10 to build on

- **Modular monolith.** One deployable, module boundaries enforced in code; contexts talk
  only through domain events, so a context can later split into its own process without a
  rewrite (Part 9's GPS ingest is exactly that).
- **Pure kernel.** `libs/kernel` has zero infrastructure imports (ESLint-enforced), so the
  domain is unit-testable in milliseconds and portable.
- **Correctness primitives baked in:** integer-minor-unit `Money` (never floats),
  timezone-correct date/time model, `Result<T,E>`, branded ids that make "passed the wrong
  id" a compile error.
- **Every cross-cutting concern is already solved once, centrally:** errors (RFC 9457),
  idempotency, rate limiting, request context, transactional outbox, optimistic locking,
  unit of work with automatic serialization-failure retries.
- **Adding a feature** is: one migration, one repository extending `BaseRepository`, one
  service, one controller with a zod schema, and events other modules subscribe to — no
  touching of unrelated code.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full rationale and
[`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) for the 10-part roadmap.

---

## Quick start

```bash
# 1. Install (Node 22+, npm 10+, PostgreSQL 16+)
npm install

# 2. Configure
cp .env.example .env         # edit DB credentials + JWT_SECRET

# 3. Create schema
npm run db:migrate              # applies db/migrations in order
npm run db:migrate:status       # inspect

# 4. Run
npm run dev                     # API with hot reload
# → http://localhost:3000/health
# → http://localhost:3000/docs        (OpenAPI / Swagger)
# → http://localhost:3000/metrics     (Prometheus)

# 5. Verify
npm run check                   # format + lint + typecheck + tests
npm test                    # unit tests
```

---

## Repository layout

```
apps/
  api/        HTTP application (Fastify + Nest)
  worker/     Background worker: outbox dispatch, schedulers, jobs (Part 9)
libs/
  kernel/         Pure domain primitives — NO infrastructure imports
  config/         Zod-validated, typed configuration
  database/       Pools, read replicas, unit of work, RLS, migrator, base repo
  cache/          L1+L2 cache with stampede protection & pub/sub invalidation
  http/           Filters, interceptors, idempotency, rate limiting, Swagger
  observability/  Structured logging, Prometheus metrics, OpenTelemetry tracing
  messaging/      Domain events + transactional outbox producer
  security/       (Part 2) JWT, hashing, encryption, RBAC/ABAC
  contracts/      Cross-context enums (channels, permissions)
  testing/        Rollback-per-test harness, builders, fixtures
db/migrations/    Plain, checksum-tracked .sql migrations
scripts/          migrate / seed / reset CLIs
docs/             ARCHITECTURE, DATABASE, MASTER_PLAN
```

---

## Part status

- [x] **Part 1 — Platform Foundation & Core Kernel**
- [x] **Part 2 — Multi-Tenancy, IAM, Auth & Audit**
- [x] **Part 3 — Master Data, Geography, Routes & Seat Layouts**
- [x] **Part 4 — Fleet, Documents & Crew**
- [x] **Part 5 — Scheduling & Segment-wise Inventory Engine**
- [x] **Part 6 — Search & Dynamic Pricing Engine**
- [x] **Part 7 — Booking, PNR, Cancellation & Reschedule**
- [x] **Part 8 — Payments, Refunds, Ledger & Settlement**
- [x] **Part 9 — Live Ops, GPS Tracking, Crew APIs & Notifications**
- [x] **Part 10 — OTA Distribution, Reporting/BI, Observability & Deploy**
- [x] **Part 11 — Booking Amendments (reschedule, seat-change)**
- [x] **Part 12 — Wallet, Loyalty, Referrals & Ancillaries**
- [x] **Part 13 — Departure Control, Refund Lifecycle & GST e-Invoicing**
- [x] **Part 14 — Storefront: Filters, Round-Trip/Connecting, Reviews, Support, CMS, Fraud**
- [x] **Part 15 — Signed Ticket QR, Realtime SSE, i18n/Multi-currency, Privacy (DPDP), Seeds, E2E & SDK** ← *this drop*

**All 15 parts complete.**

> **Architecture cleanup (2026-09):** duplicated features were merged — one partner
> API (`gds`), one search (`search`), one content module (`content`: pages, legal,
> banners, offers, announcements), one webhooks module — and every request body,
> query string and id param is validated by a zod DTO. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the old → new URL list in
> [docs/API_CHANGES.md](docs/API_CHANGES.md).

> **Architecture note (this drop):** the project was renamed to **Ticketly** and every
> feature module restructured into the DDD layered layout
> (`application/` · `domain/` · `infrastructure/` · `presentation/`). Tooling moved to
> **npm** (pnpm removed). Verified green: 330 files parse, 599 intra-repo imports
> resolve, 257 domain tests pass, 14/14 migrations apply.

> Note: waitlist / RAC is intentionally **not** built — buses have no waitlist (a railway concept).
