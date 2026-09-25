# Ticketly — bus reservation & distribution backend

Multi-tenant bus ticketing platform: many bus operators on one system, each fully
isolated (PostgreSQL row-level security plus application tenant scoping).
**NestJS 11 + Fastify + TypeScript + PostgreSQL 16 + Redis 7**, no ORM, no Docker.

One API serves three hosts, told apart by the `Host` header:

| Host | Who |
|---|---|
| `www.ticketly.com` | Customers: search, book, manage bookings |
| `app.ticketly.com` | Platform (super) admin console |
| `app.<slug>.ticketly.com` | One operator's staff console |

---

## Run it locally

**You need:** Node.js **22** (`.nvmrc`; Node 24 does not work with NestJS/Fastify 11 yet),
PostgreSQL 16, Redis 7.

```bash
npm ci
npm run setup        # .env with fresh secrets, creates the DB, migrates, seeds the super admin
npm run dev          # API → http://localhost:3000   (Swagger: /docs)
npm run dev:worker   # second terminal: SMS / email / refunds / invoices / schedulers
```

`npm run setup` reads DB and Redis settings from `.env` (created from
[`.env.example`](.env.example) on the first run: `postgres`/`postgres` on
`127.0.0.1:5432`, database `ticketly`). Change them there if yours differ and run it again.
It is safe to re-run.

**Demo data (optional):** `npm run db:seed:full` wipes the database and loads three demo
operators with routes, buses, trips and bookings:

| Login | Password | Header to send |
|---|---|---|
| super admin from `.env` (`admin@ticketly.local`) | `Admin@12345` | `X-Debug-Surface: superAdmin` |
| `admin@demo-travels.example` | `pass@123` | `X-Debug-Surface: tenantAdmin`, `X-Tenant-Slug: demo-travels` |
| `admin@maharaja-yatra.example` | `pass@123` | same, slug `maharaja-yatra` |
| `admin@golden-arrow.example` | `pass@123` | same, slug `golden-arrow` |

Logins are host-bound (a super admin may only sign in on the platform host). Calling
`http://localhost:3000` directly looks like the customer site, so for Postman / curl /
Swagger send the `X-Debug-Surface` header above (ignored when `NODE_ENV=production`):

```bash
curl -X POST localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -H 'X-Debug-Surface: superAdmin' \
  -d '{"identifier":"admin@ticketly.local","password":"Admin@12345"}'
```

Health: `GET /health`, `/health/live`, `/health/ready`. Metrics: `GET /metrics`.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | First-time local setup (above) |
| `npm run dev` / `npm run dev:worker` | API / worker with hot reload |
| `npm run build` then `npm start` / `npm run start:worker` | Production build and run |
| `npm run check` | Format check + lint + typecheck + unit tests |
| `npm test` / `npm run test:e2e` | Unit tests / end-to-end tests (need a migrated, seeded DB and Redis) |
| `npm run check:boundaries` | Module-boundary ratchet |
| `npm run db:migrate` / `db:migrate:down` / `db:migrate:status` | Migrations |
| `npm run db:new <name>` | New migration file |
| `npm run db:seed` | Permissions, roles, plans, super admin |
| `npm run db:reset` | Drop the schema (refuses in production) |
| `npm run db:seed:full` | Reset + migrate + seed + demo operators and bookings |

## Layout

```
apps/api/        HTTP API — one folder per feature module under src/modules/
                 (application/ · domain/ · infrastructure/ · presentation/)
apps/worker/     Background worker: outbox dispatch, notifications, schedulers
libs/            kernel (pure domain primitives), config, database, cache, http,
                 messaging, observability, security, contracts, testing
db/migrations/   Plain SQL migrations, checksum-tracked
db/seeds/        Permissions, roles, plans, geography, demo operators
deploy/          systemd units, nginx, PgBouncer, PM2, release script
scripts/         migrate / seed / setup / release packaging
test/            architecture tests and end-to-end tests
load-tests/      k6 load test
docs/            architecture, per-domain notes, deployment, runbook
```

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, layering, boundaries
- [FEATURE_DEVELOPMENT.md](docs/FEATURE_DEVELOPMENT.md) — how to add a feature
- [DEPLOYMENT.md](docs/DEPLOYMENT.md), [RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md), [RUNBOOK.md](docs/RUNBOOK.md) — servers, CI/CD, operations
- [SECURITY_AND_TENANCY.md](docs/SECURITY_AND_TENANCY.md) — RLS, auth, encryption
- [API_CHANGES.md](docs/API_CHANGES.md) — URLs that changed in the 2026-09 cleanup (for the web app)
- [SCENARIOS.md](docs/SCENARIOS.md) — product scenario tracker
- Per domain: booking, amendments, payments & ledger, scheduling & inventory, search & pricing,
  fleet & crew, master data, storefront, notifications, reporting — see `docs/`.
