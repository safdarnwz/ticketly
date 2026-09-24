# Security & Multi-Tenancy (Part 2)

How the platform keeps one operator's data invisible to every other operator,
and how it authenticates and authorises the people and systems that use it.

---

## Tenant isolation — two independent layers

A cross-tenant data leak is the single worst failure a multi-operator platform
can have, so isolation does not rely on any one mechanism.

**Layer 1 — Row-Level Security (the safety net).** Every tenant-scoped table has
a `FORCE ROW LEVEL SECURITY` policy: a row is visible only when its `tenant_id`
equals `current_tenant_id()`, the per-connection GUC the app sets on each
checkout (`libs/database/tenant-session.ts`). Even a query that *forgets* its
`WHERE tenant_id = …` clause returns nothing from another tenant.

**Layer 2 — application scope (the performance path).** Repositories still emit
an explicit `tenant_id = $1` predicate, pulled from the ambient request context
(`requireTenantId()` throws rather than querying globally). This is also what
makes the composite indexes usable, so isolation and speed come from the same
predicate.

> **Deployment requirement (critical).** The application MUST connect as a
> `NOSUPERUSER NOBYPASSRLS` role. PostgreSQL silently bypasses RLS for
> superusers and `BYPASSRLS` roles, so connecting as `postgres` would disable
> every policy. Provision the app role with [`db/roles.sql`](../db/roles.sql)
> and point `DB_USER` at it. Migrations run as the owner/superuser; the app
> never does DDL.

Verified in this drop: bound to tenant A a query returns only A's rows, bound to
B only B's, and a cross-tenant `INSERT` is rejected by the policy's `WITH CHECK`.

## Tenant resolution

A request names its operator in one of three ways, resolved before the auth
guard runs (`tenant-resolution.middleware.ts`), first hit wins:

1. `X-Tenant-Id` header — internal / console calls.
2. Host or subdomain — Ticketly's three-domain scheme (`www.ticketly.com` for
   the customer storefront, `app.ticketly.com` for the super-admin console,
   `app.<slug>.ticketly.com` for one operator's admin console), or a verified
   custom domain. This is how a storefront/console request identifies its
   operator with no header. The slug→id lookup is cache-backed (short TTL).
3. The JWT or API key's embedded tenant — bound by the auth guard.

---

## Authentication

**Default-deny.** Every route requires authentication unless marked `@Public()`.
Defaulting to open would make one forgotten annotation a breach.

Two credential types, both enriching the request context with the principal and
its permission set:

- **Bearer JWT** — operator console and customer app. HS256, verified with
  Node's `crypto` (no `jsonwebtoken` dependency), constant-time signature
  compare, strict `alg` check (blocks `alg:none` / algorithm-confusion), and
  key-rotation support via `JWT_SECRET_PREVIOUS`. Access tokens are short-lived
  (15 min) and stateless — no DB hit on the hot path.
- **X-Api-Key** — OTA / channel partners. Format `gds_<prefix>_<secret>`; only a
  SHA-256 is stored, the plaintext is shown once. Verification is a single
  prefix-indexed lookup, cache-backed because a busy partner presents the same
  key thousands of times a minute.

**Login flows.** Email+password for staff (scrypt hashing, memory-hard, no
native addon to compile — respects the no-Docker/no-gyp constraint); phone/email
**OTP** for customers. Both apply uniform-failure timing so an attacker cannot
enumerate which accounts exist. Repeated failures **lock the account** — a rule
enforced inside the `User` aggregate so no code path can skip it.

**Sessions & rotation.** Refresh tokens are long-lived but revocable: only a
hash is stored, and each refresh **rotates** the token (issues a new one, revokes
the old). Replaying an already-rotated token is treated as theft and kills the
user's whole session chain. Logout, password change and role change all revoke
sessions.

## Authorisation — RBAC + ABAC

- **Permissions** are a typed catalogue (`libs/contracts/permissions.ts`), format
  `resource:action`. A typo is a compile error, not an unenforced route.
- **Roles** bundle permissions. Five system roles
  (owner/admin/manager/support/viewer) are seeded for every operator at
  provisioning; operators can add custom roles.
- **`@RequirePermission('booking:cancel')`** gates a handler; the guard checks a
  set that was resolved once at authentication (no per-request DB hit). `*`
  (owner / platform admin) satisfies anything.
- **ABAC** conditions on a role (e.g. "manager limited to routes X, Y") are stored
  as jsonb and evaluated by feature-level policies against the resource.

## Provisioning & audit

**Provisioning** an operator is one transaction: the tenant, its five system
roles, and its owner user are created atomically, then the tenant is activated —
a partial provision is impossible. The endpoint is idempotent.

**Audit** — every security- and money-significant action (suspend operator, grant
role, refund) writes an append-only `audit_log` row, partitioned by month. Actor,
tenant, IP and correlation id come from the request context, so call sites pass
only the *what*. Sensitive actions write the audit row inside the same
transaction as the change, so the trail can never diverge from reality.

## Feature flags & quotas

A tenant's effective features are `plan.features ∪ tenant.overrides`, resolved by
`TenantContextService` and cached with a short TTL — so a plan upgrade or a
per-tenant override takes effect within seconds, no deploy. Suspended operators
stop being served within the same window. Later parts gate capabilities on these
flags (dynamic pricing, GPS tracking, OTA distribution).

## PII protection

Passenger email and phone are stored **encrypted** (AES-256-GCM, random IV per
value, authenticated) and looked up through a deterministic **blind index** (a
keyed hash) so exact-match search still works without decrypting every row. The
encryption key is required in production; keys are versioned for rotation.
