# Feature Development Guide

How to add a feature so the codebase stays 10/10 to build on. The architecture
is designed so a new feature touches only its own module.

## The recipe (adding a resource)

1. **Migration** — `npm run db:new add_promotions`. Include the standard columns
   (`id uuid`, `tenant_id`, `created_at/updated_at`, `deleted_at`, `version`) and
   `SELECT apply_tenant_rls('promotions');`. Add a `-- migrate:down`.

2. **Domain** (if there's real logic) — a pure, dependency-free module under
   `modules/<ctx>/domain/`. Write it as a value object / pure function and TEST
   IT (happy, negative, edge) before anything else. This is where correctness
   lives; it runs in milliseconds with no DB.

3. **Repository** — extend `BaseRepository` for tenant scope, pagination and
   optimistic locking, or hand-write SQL via the `sql` composer. Never
   interpolate values; always `$1, $2`. Reads that inform a write use the primary.

4. **Service** — orchestrate in a `UnitOfWork` (`this.uow.run(...)`). Money- or
   inventory-touching work is one transaction. Publish domain events via
   `EventBus` — never call another module's service directly.

5. **Controller** — a zod schema (`zodBody(...)`) gives validation + inferred
   types + OpenAPI for free. Gate with `@RequirePermission(...)`. Any handler
   that moves money or consumes inventory MUST be `@Idempotent()` (the
   architecture test fails the build otherwise).

6. **Module** — wire it, add it to `AppModule`, export what other modules need.

7. **React to it elsewhere** — another module subscribes to your event by adding
   ONE handler; your module never changes.

## The rules that keep it clean (enforced, not hoped)

- **Kernel stays pure** — ESLint forbids infra imports in `libs/kernel`.
- **No raw `process.env`** — ESLint forbids it outside `libs/config`.
- **Money is `Money`** — never a float; the type makes mistakes hard.
- **Ids are branded** — passing a `RouteId` where a `TripId` is expected is a
  compile error.
- **Idempotency on money/inventory** — enforced by `test/architecture`.
- **Tenant scope is ambient** — `requireTenantId()`, never a method parameter;
  RLS is the net beneath it.

## Example: "send a WhatsApp on refund"

One file. Add a handler in the notification module subscribing to
`booking.cancelled`, add a `booking.cancelled`/`whatsapp` template. The booking
and payment modules are untouched, not redeployed, and cannot be broken by it.
That is the whole point of the event-driven, modular design.
