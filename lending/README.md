# Instant Lending Platform

Digital short-term loan platform with a **5-minute instant disbursement** journey:
OTP login → KYC → bank verification → credit & risk → approval → KFS & e-sign → IMPS payout.

| Part | Stack |
|---|---|
| `backend/` | NestJS 11, TypeORM 0.3, PostgreSQL 16, UUIDv7 primary keys |
| `frontend/` | React 19 + Vite (customer journey with a live 5:00 timer) |
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
5 staff accounts (it prints their TOTP secrets) and a sandbox pricing policy.

### Sandbox test data

| Input | Result |
|---|---|
| OTP | Shown on screen in sandbox |
| PAN digits 0001–5999 (e.g. `ABCDE1234F`) | Bureau 760, auto-approved |
| PAN digits 6000–6999 | Bureau 680, manual review |
| PAN digits 7000–7999 / 8000–8999 | Low score / write-off, rejected |
| PAN digits 9000–9999 | New to credit, manual review |
| PAN ending `Z` | PAN invalid |
| Account ending `0000` / `1111` | Not found / not in your name |
| Account ending `2222` | IMPS fails, NEFT fallback succeeds |
| Account ending `3333` | Account closed, loan cancelled |
| e-sign OTP | `123456` |

## Tests

```bash
cd lending/backend && npm test
```

```bash
cd lending/backend && TEST_DATABASE_URL=postgres://lending:lending@localhost:5432/lending_test npm run test:e2e
```

The e2e suite drives the whole journey against a real PostgreSQL database (it drops and recreates
the schema of the test database). It covers IMPS→NEFT fallback, the closed-account cancel path,
name mismatch, rejection, manual review, KFS hash checks, webhook signatures, maker-checker,
role conflicts, the append-only audit log and the SLA metrics.

## API (prefix `/api`)

Customer: `POST auth/otp/request`, `POST auth/otp/verify`, `POST applications`, `GET applications/:id`,
`POST applications/:id/kyc`, `…/bank-account`, `…/assessment`, `GET …/kfs`, `POST …/kfs/accept`,
`POST …/esign/initiate`, `POST …/esign/complete`.

Staff (password + TOTP): `POST staff/login`, `GET admin/roles`, `admin/staff`, `admin/pricing-policies`
(draft / activate), `admin/applications/review-queue`, `POST admin/applications/:id/review`,
`admin/disbursements`, `POST admin/reconciliation/run`, `GET admin/metrics/instant-disbursal`, `GET admin/audit`.

Provider callback: `POST webhooks/payout` (header `x-signature` = HMAC-SHA256 of the raw body).

## Before going live

- Live adapters for each port, signed vendor contracts, and RBI outsourcing oversight.
- Real secrets in a secrets manager (`JWT_SECRET`, `PII_ENCRYPTION_KEY`, `PII_HASH_PEPPER`, `PAYOUT_WEBHOOK_SECRET`). The app refuses to start in live mode without them.
- DLT-registered SMS template for OTPs, rate limiting at the edge, VAPT and a security audit.
- Board-approved pricing and APR cap, legal review of the KFS and loan agreement text.
- Not built yet: repayment collection (UPI / eNACH), overdue tracking, bureau reporting, RBI returns, admin panel UI.
