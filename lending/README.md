# Instant Lending Platform

Digital short-term loan platform with a **5-minute instant disbursement** journey:
OTP login → DigiLocker eKYC (Digio) → bank verification → credit & risk → approval → KFS & Aadhaar eSign (Digio) → IMPS payout,
then self-service repayment by UPI / net banking / debit card (no eNACH).

| Part | Stack |
|---|---|
| `backend/` | NestJS 11, TypeORM 0.3, PostgreSQL 16, UUIDv7 primary keys |
| `frontend/` | React 19 + Vite: customer journey with a live 5:00 timer, and the Owner pricing panel at `/#owner` |
| `docs/INSTANT_DISBURSAL.md` | Business plan addendum: journey, integrations, compliance, 5-person team |

> All external integrations run as **sandbox simulators** by default. No real KYC, bureau pull,
> e-sign or money movement happens until live adapters are written for contracted providers
> (`backend/src/integrations/ports.ts`) and `INTEGRATIONS_MODE=live` is set.
> Do not lend before the RBI Certificate of Registration.

## Run locally

```bash
cd lending && docker compose up -d
```

```bash
cd lending/backend && npm install && npm run seed && npm run start:dev
```

```bash
cd lending/frontend && npm install && npm run dev
```

Open http://localhost:5173. Migrations run automatically on start. `npm run seed` creates the
5 staff accounts (it prints their TOTP secrets) and a default pricing plan. Log in as `staff1@example.com`
(the owner; password `ChangeMe-123456`, code from the printed TOTP secret) at http://localhost:5173/#owner
to change pricing or create offers.

### Sandbox test data

| Input | Result |
|---|---|
| OTP | Shown on screen in sandbox |
| DigiLocker (sandbox) | Type the PAN / name / DOB DigiLocker would return |
| PAN digits 0001–5999 (e.g. `ABCDE1234F`) | Bureau 760, auto-approved |
| PAN digits 6000–6999 | Bureau 680, manual review |
| PAN digits 7000–7999 / 8000–8999 | Low score / write-off, rejected |
| PAN digits 9000–9999 | New to credit, manual review |
| PAN ending `Z` | eKYC rejected |
| Account ending `0000` / `1111` | Not found / not in your name |
| Account ending `2222` | IMPS fails, NEFT fallback succeeds |
| Account ending `3333` | Account closed, loan cancelled |
| Aadhaar eSign OTP (sandbox) | `123456` |
| Repayment (sandbox) | Sandbox payment page: UPI, net banking, debit card or failure |

## Tests

```bash
cd lending/backend && npm test
```

```bash
cd lending/backend && TEST_DATABASE_URL=postgres://lending:lending@localhost:5432/lending_test npm run test:e2e
```

The e2e suite drives the whole journey against a real PostgreSQL database (it drops and recreates
the schema of the test database). It covers IMPS→NEFT fallback, the closed-account cancel path,
name mismatch, rejection, manual review, KFS hash checks, webhook signatures, owner-only pricing,
personal and campaign offers, frozen terms after plan edits, DigiLocker eKYC and Digio webhooks,
agreement PDF e-sign, UPI repayment with part payment and closure, overdue penal accrual, reminders,
role conflicts, the append-only audit log and the SLA metrics.

## API (prefix `/api`)

Customer: `POST auth/otp/request`, `POST auth/otp/verify`, `POST applications`, `GET applications/:id`,
`POST applications/:id/kyc/start`, `POST …/kyc/complete`, `…/bank-account`, `…/assessment`, `GET …/kfs`, `POST …/kfs/accept`,
`POST …/esign/initiate`, `POST …/esign/complete`, `GET …/agreement.pdf`,
`GET loans`, `GET loans/:id`, `POST loans/:id/payments`, `POST loans/:id/payments/:paymentId/refresh`.

Staff (password + TOTP): `POST staff/login`, `GET admin/roles`, `admin/staff`,
`GET admin/pricing-plans`, `GET admin/pricing-plans/preview?mobile=&amount=`,
`POST admin/pricing-plans` and `PATCH admin/pricing-plans/:id` (OWNER only, header `x-totp` with a fresh code),
`admin/applications/review-queue`, `POST admin/applications/:id/review`,
`admin/disbursements`, `POST admin/reconciliation/run`, `GET admin/metrics/instant-disbursal`, `GET admin/audit`.

Provider callbacks (all signature-checked, status always re-read from the provider):
`POST webhooks/payout` and `POST webhooks/payment` (header `x-signature`), `POST webhooks/digio` (header `X-Digio-Checksum`).
All are HMAC-SHA256 of the raw body.

Sandbox stand-ins for provider pages (only with `INTEGRATIONS_MODE=sandbox`): `POST sandbox/ekyc/:id/complete`,
`POST sandbox/esign/:id/sign`, `POST sandbox/payments/:orderId/pay`, `GET sandbox/sms`.

## Digio

Set `EKYC_PROVIDER=digio` and/or `ESIGN_PROVIDER=digio` with `DIGIO_ENV`, `DIGIO_CLIENT_ID`, `DIGIO_CLIENT_SECRET`,
`DIGIO_KYC_TEMPLATE` (DigiStudio template, DigiLocker Aadhaar + PAN) and `DIGIO_WEBHOOK_SECRET`. Point the Digio webhook at
`https://<api-host>/api/webhooks/digio`. The website loads Digio's Web SDK (`/sdk/v11/digio.js`) for both flows.
Check the DigiLocker field mapping (`extractIdentity` in `backend/src/integrations/digio/digio.adapters.ts`) against your Digio
sandbox response before going live; it fails closed if PAN, name or DOB are missing.

## Before going live

- Live adapters for each port, signed vendor contracts, and RBI outsourcing oversight.
- Real secrets in a secrets manager (`JWT_SECRET`, `PII_ENCRYPTION_KEY`, `PII_HASH_PEPPER`, `PAYOUT_WEBHOOK_SECRET`). The app refuses to start in live mode without them.
- DLT-registered SMS template for OTPs, rate limiting at the edge, VAPT and a security audit.
- Owner-set pricing within the board-approved interest-rate policy, legal review of the KFS and loan agreement text.
- Pick a payment gateway (UPI + payment links) and an SMS provider with DLT templates, and write their adapters.
- Not built yet: CKYC upload, credit bureau reporting, RBI returns, and admin screens other than the Owner pricing panel.
