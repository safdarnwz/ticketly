# Ticketly — Target Architecture (enterprise, fast, reusable)

## 1. Decision: modular monolith — organised properly
Ticketly stays **one deployable NestJS service + worker**, on PostgreSQL (RLS multi-tenancy) and Redis.
Microservices would add network hops, distributed transactions and ops cost without solving the real
problems below. What changes is **how the monolith is organised inside**.

## 2. What is wrong today (measured, not opinion)
| Problem | Measured | Consequence |
|---|---|---|
| Too many, inconsistent modules | 48 modules; only 26 follow the standard domain/application/infrastructure/presentation layout | Hard to find things; every module looks different |
| Layer leaks | 172 SQL statements outside repositories (26 files) | Business rules mixed with SQL; hard to test/reuse |
| Tight coupling | 190 deep cross-module imports (121 after step 0) | Circular-dependency workarounds (AgentLedgerModule, GdsLedgerModule, fleet quota SQL) |
| Duplication | Agent account & GDS partner account = same ledger model twice; plan quota checked in 2 places; notification templates installed in 3 places | A fix in one place is missed in another |
| God services | payment.service 652 lines, auth.service 552, booking.service 540 | Risky to change |

## 3. Target: 10 bounded contexts
| Context | Absorbs today's modules |
|---|---|
| **identity** | iam, tenancy, onboarding, kyc, platform-settings |
| **network** | master-data, fleet, trip-vehicle |
| **inventory** | scheduling, quotas, demand |
| **pricing** | pricing, promotions |
| **sales** | booking, amendments, connections, ancillary, search, storefront, tickets |
| **finance** | payment, refunds, invoicing, payouts, trip-expenses |
| **distribution** | gds, distribution, agents |
| **operations** | crew-app, departure-control, tracking, incidents |
| **engagement** | notification, crm, reviews, support, cms, announcements, appearance, i18n, legal, privacy, fraud |
| **insights** | reporting (read models) |

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

## 8. Migration plan (incremental, nothing breaks)
| Phase | Work | Exit criteria |
|---|---|---|
| **0 — done** | Auth decorators moved to `@http` (52 imports), boundary ratchet + baseline (121) | Suite green, API unchanged |
| **1 — 3 of 4 done** | SQL moved out of incidents, demand, trip-vehicle into repositories (amendments next); booking exposes `ticketCode` via its public `index.ts` | 0 SQL in those application layers |
| **2** | Extract `AccountLedger`; agents + GDS use it; delete Agent/Gds ledger workaround modules | One ledger implementation |
| **3** | Create the 10 contexts with `index.ts` public APIs; move modules in; burn baseline 121 → 0 | `check:boundaries` at 0 |
| **4** | Split payment / auth / booking services into use-case classes | No file > 300 lines in application/ |
| **5** | `TemplateRegistry` + `Entitlements` everywhere | No duplicated installers / quota checks |
