# API changes — architecture cleanup (2026-09)

Duplicate features were merged into one module each (see
[ARCHITECTURE.md §2](ARCHITECTURE.md#2-where-it-stands)). The old URLs were
**removed, not aliased**. All paths below are under `/api/v1`.

## Removed → replacement

### Search (`storefront` merged into `search`)
| Old | New |
|---|---|
| `POST /storefront/search` | `POST /search` |
| `POST /storefront/round-trip` | `POST /search/round-trip` |
| `POST /storefront/connecting` | `POST /search/connecting` |
| `GET /search/connecting?…` | `POST /search/connecting` (JSON body) |

Search results now also carry `boardingStop` and `droppingStop`.

### Partner API (`distribution` merged into `gds`)
The per-operator partner API (`X-Api-Key`) is gone; partners use the GDS API
(`X-GDS-Key`), which sells every operator that distributes to them.

| Old | New |
|---|---|
| `POST /distribution/search` | `POST /gds/search` |
| `POST /distribution/quote` | — the price is returned by `POST /gds/search` and `POST /gds/bookings` |
| `POST /distribution/bookings/hold` | `POST /gds/bookings` (block seats) |
| `POST /distribution/bookings/confirm` | `POST /gds/bookings/:id/confirm` |
| `POST /distribution/bookings/cancel` | `POST /gds/bookings/:id/cancel` |

### Webhooks (one module for operators and GDS partners)
| Old | New |
|---|---|
| `GET /distribution/webhooks` | `GET /webhooks` |
| `POST /distribution/webhooks` | `POST /webhooks` |
| `DELETE /distribution/webhooks/:id` | `DELETE /webhooks/:id` |
| `GET /distribution/webhooks/:id/deliveries` | `GET /webhooks/:id/deliveries` |
| `GET /distribution/webhooks/catalogue` | `GET /webhooks/catalogue` |
| — | `POST /webhooks/:id/test` (new: send a signed test event) |
| GDS partner `webhookUrl` in `POST /admin/gds/partners` and `PUT /admin/gds/partners/:id/terms` | `GET` / `PUT` / `DELETE /admin/gds/partners/:id/webhook`, `POST /admin/gds/partners/:id/webhook/test` |

### Content (`cms` + `legal` + `announcements` merged into `content`)
Public reads keep their `/content/...` paths; every write moved under the
platform-admin prefix `/content/admin`.

| Old | New |
|---|---|
| `POST /content/pages` | `PUT /content/admin/pages/:slug` (create or update) |
| `POST /content/banners` | `POST /content/admin/banners` |
| — | `PATCH /content/admin/banners/:id` (new: show / hide) |
| `POST /content/offers` | `PUT /content/admin/offers/:code` (create or update) |
| `POST /cms/uploads` | `POST /content/admin/uploads` |
| `GET /legal` | `GET /content/pages?kind=legal` |
| `GET /legal/:slug` | `GET /content/pages/:slug` |
| `POST /legal/:slug` | `PUT /content/admin/pages/:slug` with `"kind": "legal"` |
| `GET /announcements` | `GET /content/admin/announcements` |
| `POST /announcements` | `POST /content/admin/announcements` |
| `DELETE /announcements/:id` | `DELETE /content/admin/announcements/:id` |
| `GET /announcements/active/customers` | `GET /content/announcements/customers` |
| `GET /announcements/active/operators` | `GET /content/announcements/operators` |
| — | `GET /content/pages` (new: list), `GET /content/admin/pages` (new: list incl. drafts) |

## Stricter validation (same URLs)
Requests that used to be accepted, and then failed deeper or silently did the
wrong thing, now get a `400` with an `issues[]` array naming the field:

- **Id path params** must be UUIDs (`/bookings/not-a-uuid` → 400 at the edge; it used to reach the database).
- **Query strings** are validated: dates must be real calendar dates
  (`YYYY-MM-DD`, `from` ≤ `to`); status filters must be a known value; numbers
  and flags (`?download=1`, `?all=1`, `?includeVoided=1`) are parsed.
- **Bodies** that were read raw are validated (platform settings, payouts,
  seat upgrade, Razorpay verify, commission, vehicle bulk import, …).
- `GET /bookings/search` needs at least one of `pnr`, `mobile`, `ticket`;
  `GET /bookings/by-pnr/:pnr` and `GET /bookings/mine` need `mobile`.

## New customer self-service endpoints
- `POST /payments/upgrade-seat/self` — `{ bookingId, mobile, ticketId, toSeatNumber }`:
  the booking's contact mobile proves ownership (as for `self-cancel`); returns
  the payment for the fare difference. Staff keep `POST /payments/upgrade-seat`.
- `POST /me/ancillaries/attach` and `GET /me/ancillaries` are open to guest
  checkout (held bookings only), like hold / payment intent / charge.

## New platform-admin endpoints (scenario tracker #1–#120)
All require a platform (tenant-less) principal.
- `GET /admin/integrations`, `GET|PUT /admin/integrations/:provider`,
  `POST /admin/integrations/:provider/enabled` (`{enabled}`),
  `POST /admin/integrations/:provider/test` (`{to}`) — Razorpay / PayU /
  Easebuzz / Paytm / MSG91 SMS / WhatsApp / SMTP credentials. Secrets are
  encrypted and only ever returned masked; a test sends one real message (or,
  for Razorpay, makes one authenticated read) with the saved credentials.
- `GET /admin/policies`, `PUT /admin/policies/{password|admin-ip-allowlist|
  suspicious-login|gst-slabs|agent-credit|data-retention|ota-release}`.
- `GET|POST /admin/role-templates`, `PUT|DELETE /admin/role-templates/:id`;
  operators: `GET /roles/templates`, `POST /roles/templates/:templateId/apply`.
- `GET /admin/tenants/audit-log/export?days=N` (CSV), `GET /admin/tenants/export`
  (operators CSV), `GET /admin/tenants/ranking?from&to&sortBy`,
  `POST|GET /admin/tenants/broadcasts`, `PUT /admin/tenants/:id/rate-limit`.
- `GET|POST /admin/platform/maintenance/windows`,
  `POST /admin/platform/maintenance/windows/:id/{notify|cancel}` — a running
  window puts the platform in maintenance mode by itself.
- `POST /admin/billing/invoices`, `GET /admin/billing/invoices[/:id]`,
  `POST|GET /admin/billing/discounts`, `DELETE /admin/billing/discounts/:id`;
  operators: `GET /operator/platform-invoices[/:id]`.
- `GET /admin/monitoring/payments?from&to`, `GET /admin/monitoring/messages?from&to`.
- `GET|POST /admin/platform/cache[/clear]`,
  `GET /admin/security/encryption`, `POST /admin/security/encryption/reencrypt`.
- `PUT /admin/tenants/:id/domain` (`{domain}` or `null`), `PUT
  /admin/tenants/:id/favicon` (`{dataUri}` or `null`); public
  `GET /operator/branding` for the site a request is served on.

## Plan quotas are enforced
Creating a staff user, route, bus, branch or agent (and reactivating a
branch) beyond the operator's plan quota (`max_users`, `max_routes`,
`max_vehicles`, `max_branches`, `max_agents`; negative / missing = unlimited)
answers 403 `TENANT.QUOTA_EXCEEDED`. Branch update / activate / deactivate of
an unknown id is now 404 (was 200).

## Changed responses
- `POST /bookings/:id/reschedule` now returns `status`. `rescheduled`: the
  booking moved (any refund due is paid automatically). `payment_required`:
  the change costs more (`amountDueMinor` = fee + fare difference) — `payment`
  carries a payment for exactly that amount, and the booking moves when it is
  captured, at the price quoted. (It used to refuse with 422 "cancel and book
  the new trip instead".) In test mode pay it with
  `POST /payments/intents/:id/charge-test` (sandbox instrument body).

## Permission fixes
- `GET /admin/tenants/plans` now requires the platform admin (it had no check).
- `admin/operator-applications/*` require a platform (tenant-less) principal; an
  operator owner's `*` no longer opens them.
- DPDP self-service (`/privacy/consents`, `POST /privacy/erasure-requests`) needs only a signed-in
  user (it wrongly required `booking:read`, which customers never have).
- Roles: an operator can only change or grant roles of its OWN tenant
  (`PUT /roles/:id/permissions` and `PUT /users/:id/roles/:roleId` used to
  accept any role id, including another operator's or a platform template).
  Role permissions must be catalogue permissions, never `*` / `platform:*`,
  and a user can only put into a role — or give someone a role holding —
  permissions they hold themselves (403 otherwise).
