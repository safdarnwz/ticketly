# Ticketly Web — Operator Console

A world-class **React + TypeScript + Tailwind** frontend for the Ticketly backend.
Premium, fast, fully typed, and driven by a **backend design system** — an
operator edits the theme in *Settings → Appearance* and every user of that
operator (per role) is re-skinned on next load.

## Domains

The SAME build serves all three hosts — `src/lib/host.ts` detects which one
from `window.location.hostname` and `router.tsx` mounts the matching router:

| Host | Surface | Router |
|---|---|---|
| `www.ticketly.com` (+ apex) | Customer storefront | `customerRouter` |
| `app.ticketly.com` | Super/platform admin console | `superAdminRouter` |
| `app.<slug>.ticketly.com` | One operator's own console | `tenantAdminRouter` |

Local dev has no real subdomain, so `?surface=superAdmin` or
`?surface=tenantAdmin&tenant=<slug>` overrides detection (plain `localhost`
defaults to the customer storefront). The backend enforces the same split at
login — an operator's staff can only sign in on their own `app.<slug>.…` host.

## Stack

- **Vite** + React 18 + TypeScript (strict)
- **Tailwind CSS**, wired to backend-driven `--yb-*` design tokens
- **TanStack Query** for server state, **axios** client (bearer + tenant +
  idempotency headers, RFC-9457 error parsing)
- **React Router** (protected routes, correct back-navigation)
- **Zustand** for auth (JWT-decoded roles, persisted)

## Architecture

```
src/
├── lib/api/        Typed API layer — one module per backend domain
├── theme/          ThemeProvider hydrates CSS vars from GET /v1/appearance
├── stores/         Auth store (login, JWT roles, api-client wiring)
├── components/
│   ├── ui/         Design-system kit — Button, Input, Select, Card, Badge,
│   │               Modal, Table, Toast, feedback (Spinner/Empty/Error)
│   ├── layout/     AppLayout, Sidebar, Topbar, BackButton (correct redirects)
│   └── common/     PageHeader, ProtectedRoute
├── pages/          One folder per feature area
├── router.tsx      Route table
└── App.tsx         Providers (Query → Toast → Theme → Router)
```

### Design system (the headline)

Every colour, radius, shadow, font and component metric is a CSS variable
(`--yb-*`). Tailwind maps utilities (`bg-primary`, `rounded-card`, `h-btn`, …) to
those variables, and `ThemeProvider` sets them at runtime from
`GET /v1/appearance?role=<role>`. The **Appearance** page edits the tokens with a
**live preview** and saves per-tenant or per-role via `PUT /v1/appearance/*`.
Because every button/input/card reads the same tokens, sizing and styling stay
consistent everywhere by construction.

## Getting started

```bash
npm install
cp .env.example .env      # point VITE_API_TARGET at your backend
npm run dev               # http://localhost:5173  (proxies /api → backend)
```

Sign in with an operator user (send the tenant slug, e.g. `demo`). The dev server
proxies `/api/*` to the backend so there is no CORS in development; in production
put both behind one reverse proxy (or set `VITE_API_BASE`).

## Coverage

Auth, dashboard, storefront search (filters + sort), bookings (lookup → detail →
tickets/verify/print, refunds, GST invoices, cancel), refunds, reviews, support
(list + create + thread), CMS & offers, risk/fraud (scorer + review queue),
i18n/currency conversion, privacy (consent toggles + erasure), and the Appearance
theme editor — all wired to real endpoints with loading / empty / error states.
