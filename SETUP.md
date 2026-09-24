# Ticketly — local setup & run

## Why `npm run dev` was crashing (and what changed)

The dev script ran the NestJS API under **`tsx`**. `tsx` uses **esbuild**, and esbuild
**does not emit TypeScript decorator metadata** (`design:paramtypes`). NestJS uses that
metadata to inject dependencies by type — so every type-injected dependency arrived as
`undefined`, producing errors like:

```
TypeError: Cannot read properties of undefined (reading 'forContext')
    at new DatabaseService (libs/database/src/database.service.ts:62)
Nest can't resolve dependencies of the AuthService (?, ...)
```

You'd fix one and hit the next — because it was one root cause affecting the whole DI graph,
not many separate bugs.

**Fix:** the dev runner now uses **SWC** (`@swc-node/register`), which *does* emit decorator
metadata (`.swcrc` → `decoratorMetadata: true`). `reflect-metadata` and the tsconfig flags
(`experimentalDecorators`, `emitDecoratorMetadata`) were already correct. No application code
had to change — every API boots once metadata is emitted.

## Why `npm run start:dev` fails on Node 24 (`ERR_MODULE_NOT_FOUND` / `ERR_REQUIRE_ESM`)

You may see either of these on **Node 24.x**:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\@nestjs\common\internal'
Did you mean to import "@nestjs/common/internal.js"?
```
```
Error [ERR_REQUIRE_ESM]: require() of ES Module '...\@nestjs\platform-fastify\index.js' not supported.
```

This is **not an app bug** — it's Node's CJS/ESM interop for `require()`-ing dual-mode
packages changing between Node versions, and `@nestjs/platform-fastify@11.x` sitting right
on that boundary. The two errors above are actually the SAME underlying issue seen with
`require(esm)` support toggled on vs. off:
- **On** (Node's default) → Node gets far enough to load `platform-fastify`, then trips on
  an internal `require('@nestjs/common/internal')` call inside it that's missing a `.js`
  extension → `ERR_MODULE_NOT_FOUND`.
- **Off** (`--no-experimental-require-module`, an earlier attempted workaround — **do not
  use it**, it's reverted in this drop) → Node refuses to `require()` the ESM module at all
  → `ERR_REQUIRE_ESM`, which is strictly worse.

**The actual fix is to run on Node 22.x**, which is what this codebase is built and tested
against (`engines.node` and the included `.nvmrc` both pin it) — the interop path that
breaks here simply isn't exercised on 22.x:

```bash
# nvm (macOS/Linux) or nvm-windows (Windows)
nvm install 22.14.0
nvm use 22.14.0        # or just `nvm use` — picks up .nvmrc automatically

node -v                 # confirm v22.14.0
rm -rf node_modules package-lock.json   # Windows: rmdir /s /q node_modules & del package-lock.json
npm install
npm run start:dev
```

If you don't use nvm on Windows, install Node 22 LTS directly from
[nodejs.org](https://nodejs.org/en/download) (pick the 22.x MSI, not 24.x) and re-open your
terminal before re-running the steps above.

## 1. Prerequisites
- Node.js 20+ (Node 22 recommended — the dev script uses `node --watch`)
- PostgreSQL 16 running locally

## 2. Install
```bash
npm install
```
This pulls the new dev dependencies: `@swc/core`, `@swc-node/register`, `tsconfig-paths`.

## 3. Configure environment
```bash
cp .env.example .env
```
Set at least: `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`,
and (optional) `GMAIL_USER/GMAIL_APP_PASSWORD`, `SUPER_ADMIN_EMAIL/PASSWORD`, and the
`PAYMENT_TEST_*` sandbox values.

## 4. Create the database (once)
```bash
createdb ticketly         # or: psql -U postgres -c "CREATE DATABASE ticketly;"
```

## 5. Migrate
```bash
npm run db:migrate          # apply all migrations
npm run db:migrate:status   # (optional) see what's applied
```

## 6. Seed — ONE command, ONE thing seeded: the super admin

```bash
npm run db:seed
```

This is `scripts/seed.ts`, and it does exactly this, in one transaction:
1. Permission catalogue (`permissions.seed.sql`)
2. System role templates + their permission grants (`roles.seed.sql`)
3. Subscription plans (`platform.seed.sql`)
4. The ONE super-admin account — read from `.env`:
   ```
   SUPER_ADMIN_EMAIL=admin@ticketly.com
   SUPER_ADMIN_PASSWORD=Test@123
   SUPER_ADMIN_NAME=Ticketly Super Admin
   ```

**No demo tenant, no demo operator, no demo bookings, nothing else.** Step 4 does NOT
hand-craft a SQL `INSERT` for the user — email/phone are stored **encrypted** with a
blind index (`FieldEncryptor`), and the password hash's cost parameters come from env
(`PASSWORD_HASH_*`), so a guessed raw `INSERT` can silently drift from what this
environment is actually configured with. The script instead constructs the app's REAL
`PasswordHasher`/`FieldEncryptor` from the same `AppConfig` the API boots with, so it's
always correct regardless of what those env vars are set to.

Fully idempotent — re-running `npm run db:seed` on top of itself is safe (it upserts the
super admin's password rather than erroring, and every other step is `ON CONFLICT DO
NOTHING`). `AdminBootstrapService` also runs this same super-admin step again on every
API boot as a second safety net, so even if you skip `db:seed`, starting the API with
`SUPER_ADMIN_EMAIL`/`PASSWORD` set will still create/fix it.

Sign in at **`app.ticketly.com`** (or `http://app.localhost:5173` in local dev) with
`admin@ticketly.com` / `Test@123` — per `AuthService.isAllowedOnSurface`, this account
can **only** authenticate on that host, nowhere else.

## Wiping an existing dev database back to "just the admin"
If you ran older demo seeds (or clicked around and created test data) and want a clean
slate:
```bash
npm run db:reset          # DROPs the whole schema (dev/test only — refuses on production)
npm run db:migrate        # recreate tables
npm run db:seed           # permissions + roles + plans + super admin — nothing else
```

## 7. Run the backend
```bash
npm run start:dev      # NestJS API, hot-reload, via SWC   (alias: npm run dev)
npm run dev:worker     # (optional) background worker
```
The API listens on `http://localhost:3000` (Swagger at `/docs` if enabled).

## Testing login directly (Postman/curl/Swagger, not through the web app)

Logins are **host-bound**: which of the three domains a request came in on decides
who's allowed to sign in (`AuthService.isAllowedOnSurface`) — a super admin can only
authenticate on the platform host, an operator's staff only on their own
`app.<slug>.…` host, a customer only on the storefront host. Hitting the API directly
at `http://localhost:3000/...` looks like the **customer** surface (bare `localhost`),
so `POST /api/v1/auth/login` with the seeded super-admin credentials will 401 there
with a generic "Invalid credentials" — same message a wrong password would give, by
design (it doesn't leak which surface rejected it).

To test as super admin without any of that, send an extra header — **non-production
only**, ignored entirely when `NODE_ENV=production`:
```
X-Debug-Surface: superAdmin
```
(`tenantAdmin` and `customer` are the other two valid values; combine `tenantAdmin`
with `X-Tenant-Slug: <slug>` to also pick which operator.)

## 8. Run the frontend (separate `ticketly-web` project)
```bash
cd ticketly-web
npm install
npm run dev            # Vite dev server
```

---

## No demo data by design

Earlier drops seeded a demo tenant + a multi-stop Delhi → Jaipur → Udaipur → Ahmedabad
route to click around with. That's been removed — the only account seeded now is the
super admin (§6b). To try the full booking flow, sign in at `app.ticketly.com` as the
super admin, approve (or directly provision, via `POST /v1/admin/tenants`) a real
operator, then sign in to THAT operator's own `app.<slug>.ticketly.com` console and set
up routes/buses/schedules from there.
