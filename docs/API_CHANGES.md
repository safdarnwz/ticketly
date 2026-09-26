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

## Seats and sales rules (scenario tracker #42, #136–#141, #170–#174, #294, #421)
- `POST /master-data/seat-layouts/:id/seats/mark` (`{seatNumbers, position?, ladiesOnly?, accessible?}`)
  and `POST /master-data/seat-layouts/:id/seats/auto-positions` — each saves a new layout version.
  Seat maps and `GET /scheduling/trips/:id/availability` carry `accessible`.
- `GET|PUT /scheduling/services/:id/sales-rules` — `otaReleasePct` (share of each
  trip OTAs / GDS partners may sell; default = platform policy) and
  `categoryQuotas.female|senior` (`seats` or `pct`, `releaseHours`).
- `PUT /concessions/accessible-seats` (`{releaseHours}`, null = never released).
- `POST /trips/:tripId/quotas/percentage` — reserve a % of a trip for a branch / agent.
- `POST /bookings/hold` accepts `ladiesSeatOverrideReason` (operator staff only).
  A hold can now be refused with 422 `INVENTORY.SEAT_UNAVAILABLE` for an
  accessible seat, the OTA share being used up, or seats kept for women /
  senior citizens.

## Timetables, fares in bulk, trip changes (scenario tracker #169, #266–#275)
- `PATCH /scheduling/services/:id` (departure time / recurrence / bus; each change a version),
  `GET /scheduling/services/:id/versions`, `POST /scheduling/services/:id/versions/:n/restore`,
  `POST /scheduling/services/:id/clone` (`season: true` = the original skips those dates),
  `DELETE /scheduling/services/:id` (only a service that never sold or ran; 409 otherwise).
- `POST /scheduling/trips/:id/retime` — move one trip; every passenger gets the
  `trip.retimed` SMS. Delays (`trip.delayed`) and diversions (`trip.diverted`) now
  reach every passenger of the trip (the delay SMS never went out before).
- `GET|POST /scheduling/routes/:routeId/blackouts`, `POST …/blackouts/remove`.
- `GET /reports/cancel-suggestions?days&maxPct` (trips forecast to run nearly empty) and
  `POST /trips/:tripId/cancel-suggestion/decision` (`accepted` / `rejected` + reason).
- `GET /pricing/fare-plans/:id/rules.csv`, `POST /pricing/fare-plans/:id/rules/import`,
  `POST /pricing/fare-plans/:id/rules/adjust`.

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
- `POST /admin/tenants/:id/suspend` and `/activate` now answer **200** (were 201); body unchanged.
- New `POST /bookings/:id/release-hold` `{ mobile? }` → `{ released }`: the holder (signed-in
  booking customer, or the booking's mobile) gives up an unpaid hold early, e.g. to change
  seats. Idempotent; a paid booking is never touched; 400 without any proof.
- `GET /scheduling/trips/:id/availability` and search seat counts now treat seats under a
  live (unexpired) hold as taken — they used to show as free until payment.
- Customer emails on confirmation: the one-line confirmation email is replaced by the **e-ticket**
  (journey, boarding/dropping, passengers, fare, boarding QR as an inline image; the operator's
  confirmation email template is its subject and opening text), and the **GST tax invoice** is its own
  email (invoice in the body + PDF). Each goes once per event and is logged against the booking
  (`notifications.booking_id`, `kind` = `eticket` | `invoice`, migration 0083).
- `GET /bookings/:id/ticket.html` draws the QR server-side (no external script).
- New (platform admin): `GET /admin/monitoring/bookings/activity?from&to` — per operator: holds in
  progress now, confirmed / cancelled, seats, gross; `GET /admin/monitoring/bookings?from&to&tenantId&status&channel&pnr&cursor&limit`
  — every operator's bookings newest first (`status=live` = being paid now), with each booking's
  e-ticket / invoice email status. Customer phone and email are masked. Max 92 days per request.
- **Security:** `POST /bookings/:id/cancel-seats` was open to anyone with a booking id (and could send the
  refund to any bank account). It now needs operator staff (`booking:cancel`), the signed-in customer who
  booked it, or `mobile` in the body matching the booking; only staff may pick `refundDestination:
  alternate_account` (403 otherwise). 404 for anyone else.
- Cancelling some seats now also lowers the booking's `seatCount` (it stayed at the old number); migration
  0085 repairs existing bookings.
- `GET /bookings/search` is the operator's bookings list: PNR / mobile / ticket number (any date), or a period
  `from`/`to` (default today in the operator's time zone, max 92 days) by `dateBasis=booked|journey`, with
  `status`, `channel`, `tripId`, `cursor`/`limit`. Response is `{ from, to, items, hasMore, nextCursor }`
  (was `{ items }`); each item carries journey, stops, seats, lead passenger and contact.
- `GET /bookings/by-pnr-staff/:pnr` also returns `detail`, `passengers` and `emails` (e-ticket / invoice status).
- New `POST /bookings/:id/tickets/resend` `{ email? }` (staff): emails the e-ticket again.
- `GET /reports/summary` counts "today" in the operator's time zone (it used the server's) and adds
  `todaySeats`, `todayRevenueMinor`, `liveHolds`, `liveHoldSeats`.
- `GET /scheduling/trips?date=` lists one journey date (any status); seats held by expired holds no longer
  count, and each trip has `bookedSeats` / `heldSeats`.
- **Fix:** changing a trip's status (stop / resume sales, cancel trip, crew depart / close) failed with a
  database error (`inconsistent types deduced for parameter $3`). A trip cancel refunded every booking and
  then failed, leaving the trip on sale.
- **Money:** a bus that has left (or finished its journey) can no longer be cancelled — that refunded
  everyone who travelled — nor put back on sale, nor have seats blocked. The crew app cannot close a trip
  that never departed or depart a cancelled one.
- New `GET /bookings/trips/:tripId/chart` (staff): the reservation chart — layout, every passenger per seat
  (boarding → dropping, PNR, phone, ticket status), holds being paid now, blocked seats, totals, `hasRun`.
- `POST /scheduling/trips/:id/block-seats` refuses unknown seats (400) and trips that left or were cancelled.
- **Idempotency:** a failed request no longer pins its `Idempotency-Key` to that failure. The key is released
  on any error (a failed request changed nothing), so a retry with the same key runs again once the cause is
  fixed; a success is still replayed. The store is updated before the response is sent (a quick retry used
  to get 409 "still in progress"), and replays no longer return a non-RFC-9457 error body.
- Fleet: `registrationNo` is normalised (capitals, no spaces/dashes) and must be a valid state or BH-series
  number; crew `phone` must be a 10-digit mobile.

### Operator pricing, promotions, distribution, branches (O4)

- **Fares:** a fare rule must be at least ₹1 (`baseFareMinor` ≥ 100, at most ₹1,00,000; `perKmMinor` ≤ ₹1,000).
  Saving the fare for a seat type now replaces the earlier one — whole-route rules used to pile up (NULL stops
  never collide) and a quote could read a ₹0 draft. Migration 0086 keeps the newest rule of each kind, drops
  rules at ₹0 or less and adds the checks. A per-km whole-route rule prices by the segment's real distance.
- `POST /pricing/fare-plans/:id/activate` refuses a plan with no fare (422) and clears the cached fares, so an
  activated plan applies at once (it could take 5 minutes). Unknown / another operator's plan: 404 — also for
  adding a rule or a seat price to it. `POST /pricing/fare-plans` refuses another operator's route (404).
  Seat prices are at least ₹1; removing one that is not there is a 404.
- Any fare, plan or yield-policy change also clears cached search results, so "starts from" is not stale.
- **Coupons:** `POST /pricing/coupons` — `value` is 1–100 for `percent`, and paise ≥ 100 for `flat`;
  `maxDiscountMinor` only for percent coupons; `validTo` after `validFrom` and in the future; `code` is 2–40
  of `A-Z 0-9 - _` (stored upper-case). Duplicate code: 409 "A coupon with this code already exists".
  Enable / disable / stats of an unknown or another operator's coupon: 404. `GET /pricing/coupons` also
  returns `minFareMinor`, `maxDiscountMinor`, `perUserLimit`. Migration 0087 adds the matching DB checks.
- **Yield policies:** multipliers are 0.5×–3× (0× priced seats at ₹0), each occupancy level / day count once,
  at most 10 steps each. One active policy per route and one operator-wide: a new one replaces the earlier
  one (migration 0088, unique index). New `POST /pricing/policies/:id/deactivate`. `GET /pricing/policies`
  returns `ladder`, `isActive`, `createdAt` (no `gstRatePct` — GST is set by the platform only).
- **Promotions:** new `GET /promotions/quote?routeCount&startDate&endDate` — the exact price a purchase
  charges. `POST /promotions` now requires `Idempotency-Key`; two requests for the same route and days can no
  longer both be charged; only published routes of the operator (draft: 422, not theirs: 404); overlap errors
  name the route. A paused promotion can be cancelled (unused days credited). `GET /promotions` items carry
  `routeName` and `pausedAt`. Search now applies paid top slots after the customer's sort — sorting used to
  push the promoted bus back down, so the slot was paid for and never shown.
- **Webhooks:** the URL must be public https — no localhost, private / link-local / metadata addresses,
  internal host names or credentials in the URL (400). Every send re-checks where the name resolves and
  does not follow redirects. One live registration per URL (409; migration 0089), at most 10 per operator.
  Revoke / deliveries / test of an unknown or another operator's webhook: 404.
- **Branches:** name 2+ characters and unique per operator ignoring case (409); phone must be a number
  with STD code (10–12 digits); opening hours are HH:MM; the manager must be staff of this operator (404).

### Refunds, reviews, support (O5)

- **Refunds:** `POST /refunds` now passes `altAccountDetails` on to the refund — a refund to another bank
  account always failed with "requires account details". Account number 9–18 digits (spaces dropped), IFSC
  upper-cased and checked, holder 2+ characters; the amount is at least ₹1.
- `POST /refunds/:id/manual` takes `{ reference }` (the transfer's UTR, 6–30 letters/digits) and also closes
  a refund to another account once the transfer is sent (such refunds used to stay `processing` for ever).
  A gateway refund still in flight is refused (422); an already paid one too. Migration 0090 stores
  `payout_reference`, `paid_by`, `paid_at`.
- New `GET /refunds?queue=action|processing|done|all&pnr&cursor&limit` — the refunds queue with PNR,
  contact, amount, destination (account masked), failure reason, UTR; `needsAction` counts failed refunds
  and transfers to send. New `GET /refunds/:id/payout` (payment:refund) — the full account to transfer to.
- `GET /bookings/:id/refunds` returns `{ refunds, currency, capturedMinor, refundedMinor, refundableMinor }`
  (was `{ refunds }`), 404 for another operator's booking.
- **Reviews:** customers can post reviews again — `POST /reviews` required a staff permission. Only the
  traveller's own signed-in account may review, and only once the bus has left (a confirmed booking for next
  week could be reviewed; staff could review a guest booking). New `GET /reviews` (operator: filter
  `all|unanswered|low|reported`, `routeId`, `rating`, cursor; with star counts and totals),
  `PUT /reviews/:id/reply { reply }` (empty removes it; shown on the public route reviews),
  `POST /reviews/:id/report { reason, note? }` (409 if already reported; the review stays visible —
  operators cannot hide reviews). Migration 0091.
- **Support:** customers can open tickets again (a staff permission was required). A customer sees and
  answers only their own tickets and can only close them; staff see all of the operator's. The author of a
  message comes from the account — `authorKind` in the body is ignored (a customer could post as "agent").
  Staff can raise a ticket by `pnr` (it belongs to that booking's customer), and new `PATCH
  /support/tickets/:id { priority?, assignedTo? }` re-prioritises / (un)assigns (assignee must be this
  operator's staff). `GET /support/tickets` filters by `status` (or `active`), `priority`, `category`,
  `assigned=me|none`, `q` (subject or PNR), and returns PNR, customer, assignee, message count, who wrote
  last; most urgent first. Customer-set priority is ignored.
- **Customers (CRM):** customers hold one platform-wide account, but the customer list searched accounts of
  the operator's own tenant — it was always empty, and blacklisting updated nobody. Replaced:
  `GET /customers?q&filter=all|frequent|blocked&page&limit` lists who booked with the operator (account,
  or guest by mobile), with trips, cancellations, spend, last journey; `q` matches name, mobile (4+
  digits), exact email or PNR. `GET /customers/:key` (key = account id or 10-digit mobile) returns the
  totals, `block` and `history`. `POST /customers/:key/block { reason }` / `unblock` stop new bookings with
  this operator only, by account and by mobile (hold → 403); other operators are unaffected, existing
  bookings stay. Removed: `/customers/search`, `/customers/:id/bookings`, `/blacklist`, `/unblacklist`,
  `/preferences` (it wrote to the customer's platform account). Migration 0092 (`customer_blocks`).
- **Reports:** the reporting views are rebuilt (migration 0093). Revenue is grouped by the operator's own
  day (it used the UTC day — sales before 05:30 IST landed on the day before); occupancy and route
  performance sum seats per trip (a trip's capacity was counted once per booking, so occupancy showed ~1 %)
  and leave out cancelled trips; route performance covers the last 30 days up to today (it counted every
  future trip). `GET /reports/occupancy` rows carry `routeName`; numbers are numbers, not strings. The
  cancellation rate is over sold bookings (unpaid holds were counted). A report period is at most 366 days.
- **Settings:** `PATCH /operator/bank-details` — account number 9–18 digits (spaces dropped), IFSC
  upper-cased and checked, holder 2+ characters; the account already receiving payouts is refused (422) and
  the one already waiting for approval is a 409. New `DELETE /operator/bank-details/pending` withdraws the
  waiting change. `PATCH /operator/refund-policy` — whole hours, at most 10 tiers, each hour count once,
  and cancelling earlier may never refund less than cancelling later; flat fee at most ₹10,000.
  `POST /notifications/templates` only for known events, with the placeholders each event fills in (a
  typo went out as a blank), closed braces, an email subject, and SMS up to 480 characters;
  `GET /notifications/templates` also returns `catalogue` (event → label, placeholders).
- **Staff:** `GET /users?q&status&roleId&branchId&cursor` lists the operator's staff with roles, branch and
  last login; `GET /users/export.csv` exports it (formula-safe). `GET /users/:id` adds recent activity from
  the audit log. `PUT /users/:id/branch { branchId|null }` — an active branch of this operator only.
  `DELETE /users/:id/roles/:roleId` removes a role and signs the person out; a staff member keeps at least
  one role (422). Nobody can disable themselves, and the last active person who can manage users can be
  neither disabled nor stripped of that role (422). Invite: mobile normalised to 10 digits, email
  lower-cased, name trimmed; a used email or mobile is a 409 with a readable message.
  `GET /users/performance?from&to` (REPORT_READ, ≤366 days) — bookings, seats, sales and cancellations per
  staff member. Bookings made at the counter now record the seller in `bookings.booked_by` instead of
  `customer_id` (staff sales no longer show up as the staff member's own trips); migration 0094 moves
  existing rows.
- **Roles & staff access:** `GET /roles` rows carry `holders` (people holding it now). New
  `GET /roles/permissions` — the permission catalogue grouped with labels, and `grantable` for the caller.
  Built-in roles can no longer have their permissions changed (422, duplicate instead — the schema always
  said so, the code did not check). A role needs 1–100 permissions; codes are lower_snake_case 2–40 for
  create and duplicate alike; a role name already used (any case) is a 409. Removing staff management from
  a role is refused when nobody else could then manage staff; so is making the last manager's managing role
  temporary. `PUT /users/:id/access` — no limits on yourself, an end date in the future, and the last staff
  manager cannot be limited. New `PUT /users/:id/password { password }` (USER_MANAGE): an admin sets a new
  password for a staff member, lifts a failed-login lock and signs them out everywhere; not for yourself.
  Directory rows carry `loginWindow`.
- **Staff upload, targets, warnings, own account:** `GET /users/import-template.csv` and
  `POST /users/bulk-import { rows }` (≤200 rows, columns full_name, email, mobile, role, branch) — each row
  stands alone with its own error (bad fields, same email/mobile as an earlier row, unknown role or
  branch, already used); starting passwords come back once in `created`. `PUT|DELETE /users/:id/target
  { dailyBookings, dailyRevenueMinor? }`; `GET /users/performance` rows carry `targetBookings` /
  `targetRevenueMinor` for the period. `POST /users/:id/warnings { reason, note }` (not yourself, active
  staff only, the same warning twice within 10 minutes is a 409). `GET /users/me` — my roles, activity,
  warnings and target; `POST /users/me/warnings/:id/acknowledge`. `GET /users/:id` adds `warnings` and
  `target`. New `POST /auth/password { currentPassword, newPassword }` changes your own password (it did
  not exist); other sessions end, this one stays. Access tokens carry `iatMs`: signing in within the same
  second as a forced sign-out was refused. Migration 0095.
- **Agents & API keys:** an agent's `branchId` must be an active branch of this operator (404 for an
  unknown or other operator's branch — it used to be linked, or fail as a generic 409). `POST /api-keys`:
  scopes become the key's permissions, so they must be catalogue permissions the issuer holds — never `*`
  or platform ones (403; any `role:manage`-style escalation was possible before); IP allow-list entries
  are checked, the expiry must be in the future, the name is trimmed, and the issuer is recorded.
- **Company profile:** `PATCH /operator/profile` no longer takes `settings` (sending it replaced the
  whole JSON and wiped the logo and invoice prefix) and refuses unknown fields; it takes `secondaryContact`
  (null removes) and a structured `address` (also the invoice address); mobile numbers are normalised,
  the time zone must exist, and the currency cannot change once there are bookings (422). `GET` returns
  the contacts, address, legal name and GSTIN (those two stay with the platform).
- **Concessions:** `PUT /concessions/rules` refuses bands that sell the wrong fare (422): a child band
  needs its oldest age, below adult age and not below infant age; a senior band needs a starting age of at
  least adult age; no active 0% rule; no end date in the past. `PUT /concessions/policy` refuses an adult
  age at or below an active child band's oldest age.
- **Schedule:** a clone cannot start in the past; a timetable edit cannot end the service in the past
  and an ended service is not edited (clone it); restoring a version that already ended is refused;
  blackout dates must be today or later; a women / senior quota in seats cannot exceed the bus's seats
  (a 100 % ladies-special quota stays allowed). All 422 with the reason.
- **Seat quotas (fix):** `POST /trips/:tripId/quotas` and `/quotas/percentage` never succeeded — the
  free-seat check compared bigint masks (parsed to numbers) with the string '0', so every seat looked sold
  and every allocation was a 409. The check is now done in SQL.
- **Trip sales channels:** the chart's `trip` carries `closedOnTrip` and `closedByService`;
  `PUT /trips/:tripId/closed-channels` is refused (422) once the bus has left or the trip was cancelled.
- **No-show:** `POST /bookings/tickets/:ticketId/no-show` only after the bus's departure time (the
  passenger could still turn up) and never on a cancelled ticket (422).
- **Reschedule (fix):** moving a booking to another bus/seat now moves its passengers and tickets too
  (trip, seat, boarding code). Before, only `booking_seats` moved: the chart showed the passenger in the
  old seat, the new seat looked free while its inventory was taken, and boarding on the new bus failed.
  Migration 0096 repairs bookings already affected. A reschedule must name one new seat per passenger,
  each once (422).
- **Pricing rules:** new `GET /pricing/routes/:routeId/rules` and `GET /pricing/trips/:tripId/adjustment`.
  Saving route rules or a trip fare change checks the route / trip is this operator's (404; an unknown id
  was a 409 and another operator's could be linked); a trip fare change is refused once the trip left or
  was cancelled (422); both refresh cached search prices.
- **Maintenance log:** `POST /fleet/vehicles/:id/maintenance` records work already done — `performedOn`
  in the future is 422, `nextDueOn` must be after `performedOn`, description at least 3 characters, cost up
  to ₹1 crore (400). An unknown or another operator's bus is 404 (was a 409); the history read is 404 too.
- **Crew:** new `PATCH /fleet/crew/:id` (name, mobile, licence, employee code, `status`
  active / on_leave / inactive; null clears a detail). Leave or inactive is refused while the person holds
  upcoming duties (422). A driver must have a licence number and expiry, on create and edit. One mobile per
  person in the team (409, also against older `+91…` rows); duplicate employee code 409 with a message.
  `GET /fleet/crew` takes `status`, and each row carries `phone`, `employeeCode`, `upcomingDuties`.
- **Duties:** `POST /fleet/crew/duties` refuses a duty that already ended (400), an unknown / another
  operator's crew or trip (404), a cancelled trip, crew on leave / inactive, and a driver whose licence
  expires before the duty ends (422). `POST /fleet/crew/duties/:id/cancel` is 404 for an unknown duty,
  a no-op when already cancelled, and 422 once attendance is marked or the duty has ended.
  `GET /fleet/crew/duties` rows add `crewRole`, `tripLabel`, `attendance`, `overrideReason`.
  `GET /fleet/crew/:id/allowance` is 404 for an unknown crew member.
- **Lost & found:** `POST /lost-found` needs an `idempotency-key` (a double click logs one item); an
  unknown or another operator's trip is 404 (was a 409, and the global key accepted anyone's trip). The
  list adds `trip_label`; the seat is stored in capitals.
- **Shift notes:** `POST /shift-notes` needs an `idempotency-key`. A `branch` note must name a branch
  (422), a `dispatch` note must not (422); an unknown / another operator's branch is 404, a closed one 422.
- **Incidents:** the list adds `trip_label`.
- **Dispatch report:** `GET /reports/dispatch` covers at most 366 days (422).
- **Cancel suggestions:** `POST /trips/:tripId/cancel-suggestion/decision` is refused (422) for a trip that
  already left or was cancelled.
- **Agent refunds (fix):** `POST /refunds` for a booking an agent sold (offline capture) was a 500
  "Database error" — the refund ledger split compared a text id with a uuid. It now settles and credits
  the agent's account.
