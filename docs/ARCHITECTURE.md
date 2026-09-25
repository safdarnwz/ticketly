# Ticketly — Target Architecture (enterprise, fast, reusable)

## 1. Decision: modular monolith — organised properly
Ticketly stays **one deployable NestJS service + worker**, on PostgreSQL (RLS multi-tenancy) and Redis.
Microservices would add network hops, distributed transactions and ops cost without solving the real
problems below. What changes is **how the monolith is organised inside**.

## 2. Where it stands

Measured at the end of the 2026-09 cleanup (the starting numbers are in brackets):

| Area | Now | Was |
|---|---|---|
| Feature modules | 45 — every feature lives in exactly one | 48, with 4 duplicated features (below) |
| Cross-module deep imports | 14 (ratchet baseline) | 190 |
| Request bodies validated | all (zod DTOs in `presentation/dto`) | ~20 bodies read raw |
| Query strings validated | all (`zodQuery`) | 62 raw `@Query('x')` strings |
| Id route params validated | all (`@UuidParam`) | none |
| Schemas declared inside controllers | 0 | 26 controllers |
| Files with SQL outside `infrastructure/` | 0 (enforced by `test/architecture/sql-location.arch.spec.ts`) | 26 |

Duplicates removed (one implementation kept, the richer one, with the missing
parts of the other merged in):

| Was | Now |
|---|---|
| `distribution` (per-operator partner API, X-Api-Key) + `gds` (multi-operator) | `gds` — the one partner API; webhooks → `webhooks` |
| `storefront` search + `search` + connecting search in `connections` | `search` (`/search`, `/search/round-trip`, `/search/connecting`) |
| `cms` + `legal` + `announcements`; `cms_pages` + `platform_legal_pages` | `content`; one `content_pages` table (status **and** version/effective date) |
| `AgentLedgerModule`, `GdsLedgerModule` workaround modules | `RefundCreditorRegistry` port in `refunds`; agents and GDS register creditors |
| partner webhooks stored twice (`partner_webhooks`, columns on `gds_partners`) | `webhooks` module, one table, one delivery engine |
| `channel_partners` (unused) | dropped |
| `health` + `system` | `system` (health, readiness, metrics) |
| `platform_charges` written from four places (fees, promotions, settlement) | `PlatformChargeRepository` + `PlatformBillingService` |
| Status vocabularies repeated as string unions in DTOs, services and SQL | one `*_STATUSES` const per vocabulary in the owning module's `domain/` |

## 3. Bounded contexts
| Context | Modules |
|---|---|
| **identity** | iam, tenancy, onboarding, kyc, platform-settings, integrations |
| **network** | master-data, fleet, trip-vehicle, branches |
| **inventory** | scheduling, quotas, demand |
| **pricing** | pricing, promotions |
| **sales** | search, booking, amendments, connections, ancillary, tickets |
| **finance** | payment, refunds, invoicing, trip-expenses |
| **distribution** | gds, agents, webhooks |
| **operations** | crew-app, departure-control, tracking, incidents, realtime |
| **engagement** | notification, crm, reviews, support, content, appearance, i18n, privacy, fraud |
| **insights** | reporting |
| **platform** | files, system |

## 4. Rules inside every context
```
contexts/<name>/
  domain/          pure rules + types, 100% unit-tested, no I/O (already the pattern for hold-validation, pricing-rules, …)
  application/     use cases (one class per use case, ≤ 200 lines), orchestrate domain + repositories
  infrastructure/  the ONLY place with SQL / Redis / HTTP clients
  presentation/    thin controllers + zod DTOs, no logic
  index.ts         PUBLIC API: the facades/types other contexts may use — nothing else is importable
```
* Cross-context calls: **synchronous** through the other context's `index.ts` facade; **asynchronous** through outbox domain events.
* `index.ts` exports services, repositories, domain types/enums and DTO schemas — **never** the Nest `*Module`
  class. Modules are imported from their own file (`../booking/booking.module`), which keeps barrel imports
  free of module load cycles.
* When two modules need each other, the lower one defines a **port** and a registry, the higher one
  registers an implementation at `onModuleInit` (e.g. `RefundCreditorRegistry`, `WebhookAudienceRegistry`) —
  no forwardRef, no workaround modules.

### Presentation conventions
* Every body: `@Body(zodBody(XSchema)) dto: XDto`; every query: `@Query(zodQuery(XQuerySchema)) q: XQueryDto`;
  every entity id: `@UuidParam('id')`. Nothing is parsed by hand in a handler.
* Schemas live in `presentation/dto/<name>.dto.ts`, each followed by `export type XDto = z.infer<typeof XSchema>`.
* Shared query fragments come from `@http`: `DateRangeQuerySchema`, `OptionalDateRangeQuerySchema`,
  `SegmentQuerySchema`, `DownloadQuerySchema`, `FileUploadQuerySchema`, `localDateQuery`, `queryFlag`, `searchText`.
* Enumerations are defined once, `as const`, in the owning module's `domain/` — an array
  (`export const ROUTE_STATUSES = [...] as const; export type RouteStatus = (typeof ROUTE_STATUSES)[number]`)
  or, where named members read better in code, an object (`PageKind.LEGAL`). DTOs use `z.enum(...)` on it, so a
  new value is added in one place. Cross-module vocabularies (booking channels) live in `@contracts`.
* One controller per file (`*.controller.ts`); a module with several audiences has one controller per
  audience (e.g. `gds-partner`, `gds-admin`, `gds-operator`).
* Cross-cutting code (auth decorators, idempotency, rate limits, money, errors) lives in `libs/*` — never in a feature module.

## 5. Reusable building blocks (write once, use everywhere)
| Block | Replaces | Users |
|---|---|---|
| `AccountLedger` engine (prepaid/postpaid, credit limit, idempotent postings, statements) | duplicated agent + GDS ledgers | agents, GDS partners, future corporate accounts |
| `RuleSet` pattern (pure validate/evaluate + table-driven tests) | ad-hoc checks | concessions, booking window, crew rest, pricing rules, incidents |
| `TemplateRegistry` (one list of default notification templates) | 3 copies (migration, onboarding, seeds) | every new notification |
| `Entitlements` (plan features + quotas) | 2 quota implementations | every "can this operator do X / add one more Y" check |
| Tenant-scoped `Repository` base | repeated tenant/RLS boilerplate | every repository |

## 6. Performance by design
* **Reads**: L1 memory + L2 Redis cache with single-flight (already in @cache); search fan-out bounded; hot paths have no N+1.
* **Writes**: short transactions, batch SQL (`unnest`), row locks only on the rows that change, external calls outside transactions (refund dispatch pattern).
* **Reports**: served from read models / materialised views, never from OLTP joins on the booking path.
* **Scale-out**: stateless API pods; read-only queries routed to replicas (`primary: false`); worker scales independently; bookings table partitioned by month when volume needs it.

## 7. Guardrails that keep it clean
* `npm run check:boundaries` — ratchet: new cross-module deep imports fail CI; the legacy count can only go down.
* Every domain rule ships with unit tests; every phase below keeps the full suite green and the HTTP API unchanged.

## 8. Plan
| Step | Work | Status |
|---|---|---|
| 0 | Auth decorators in `@http`, boundary ratchet | done |
| 1 | Remove duplicated features (table in §2) | done |
| 2 | Validated DTOs for every body, query and id param; enums in domain | done |
| 3 | Route deep imports through `index.ts` (190 → 14) | 14 left: files, promotions, quotas, crm, agents/domain, search |
| 4 | Move all SQL into repositories (22 services, 1 controller, the worker's connection monitor) | done; an architecture test keeps it there |
| 5 | Split payment / auth / booking services into use-case classes | open |
| 6 | `TemplateRegistry` + `Entitlements` everywhere | open |

Changed URLs are listed in [API_CHANGES.md](API_CHANGES.md).
