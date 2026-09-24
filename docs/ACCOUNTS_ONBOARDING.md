# Unified Accounts, Guest Booking Auth, OTP/Email & Operator Onboarding

This drop implements the product-level auth & onboarding flows.

## Default theme = platform combination

`DEFAULT_THEME` is now the Ticketly signature palette — deep-green primary (the
"Sign in" button), purple secondary, rose accent — so every operator starts from
this look and the storefront/console/email all match.

## Unified login (email OR mobile)

`POST /v1/auth/login` accepts `{ identifier, password }` where `identifier` is an
**email or a mobile number**. User lookup is **global** (across all operators),
so login needs **no operator slug in the URL**. The JWT carries `roles`, so the
frontend redirects by role: `super_admin`/`platform_admin` →
`app.ticketly.com` (platform console), `operator_admin`/`operator_staff` →
`app.<tenant-slug>.ticketly.com` (operator console), `customer` →
`www.ticketly.com`.

## Domain scheme

| Host | Audience | Tenant bound? |
|---|---|---|
| `www.ticketly.com` (+ apex) | Customers — search, book, manage bookings | No — central, tenant-less accounts |
| `app.ticketly.com` | Super/platform admin — operator onboarding, cross-tenant ops | No — platform (`NULL`-tenant) principal only |
| `app.<slug>.ticketly.com` | One operator's staff (owner/admin/manager/support/viewer) | Yes — resolved from `<slug>` |

`TenantResolutionMiddleware` (`apps/api/src/modules/iam/presentation/tenant-resolution.middleware.ts`)
reads the `Host` header to tell these apart; a verified custom domain
(`www.orangetravels.com`) still works as a fourth case, resolved the same way
it always was.

## Guest booking → registration → payment (one flow)

At pay-time the storefront calls:

1. `POST /v1/auth/check-identity { identifier }` → `{ registered }`.
2. **Registered** → `POST /v1/auth/login` (mobile/email + password) → tokens → pay.
3. **New** → `POST /v1/auth/register { fullName, email, mobile, password }` →
   sends an **Email OTP** → `POST /v1/auth/register/verify { email, code }` →
   activates the account and **auto-logs-in** (tokens) → pay.

The account is a **central customer** (no tenant). Booking then proceeds with the
authenticated customer.

## OTP provider abstraction (Email now, SMS future)

```
OtpProvider
├── EmailOtpProvider   (live — Gmail app-password SMTP)
└── SmsOtpProvider     (stub — future, same contract)
```

Bound via the `OTP_PROVIDER` token; switching to SMS is a one-line provider
change. Email is sent through the **themed template engine** (`email-template.ts`,
pure + tested) — OTP, welcome, booking-confirmation and operator-status emails all
use the operator's theme colors. Configure Gmail with `GMAIL_USER` +
`GMAIL_APP_PASSWORD` (+ optional `MAIL_FROM`); without creds it logs instead.

## Operator onboarding (Become an Operator)

- `POST /v1/operators/apply` (public) — the full application (personal, company,
  address, business, documents). Password is hashed at apply time. Status starts
  `pending`.
- Super/Platform admin (`platform:operators`): `GET /v1/admin/operator-applications`,
  `GET …/:id`, `POST …/:id/approve`, `POST …/:id/reject { reason }`.
- **Approve** provisions a tenant + an `operator_admin` user (reusing the hashed
  password) + role grant, in one transaction, and emails the applicant. The
  tenant slug is **internal only** — never exposed in a public URL.

State machine (`application-status.ts`) is pure + tested: `pending → approved | rejected`.

## Canonical roles

Seeded system roles: `super_admin`, `platform_admin`, `operator_admin`,
`operator_staff`, `customer` (plus the operator functional roles). New platform
permissions: `platform:operators`, `platform:admin`.

## Migrations & verification

- `0017_operator_onboarding.sql` — `operator_applications` (+ enum). Platform-level.
- 17/17 migrations apply; all 4 seeds apply idempotently (10 roles, 32 permissions,
  1 demo operator application). 383 files parse; 682 imports resolve; 324 domain
  tests pass (incl. email-template + application-status).
