# Shelfwise — live stock availability dashboard

Shelfwise is a dashboard for the SalesDiary `getStockAvailablityReport` API. Users sign in with
their SalesDiary account. The dashboard turns the raw rows (one row = one SKU checked at one outlet
visit) into reports, charts and action lists. It refreshes every 5 seconds and runs from VS Code or
Docker.

```
browser ──login──▶ Node server ──findcompanyinstancewithlogo──▶ sdlogin.salesdiary.in   (company key → instance, API url, logo)
                              ──instance_pwa_login──────────▶ <instance API>           (username + password → token)
browser ─every 5s▶ Node server ──getStockAvailablityReport───▶ <instance API>           (token, cached 4 s, paginated)
```

The browser never talks to SalesDiary directly and never sees the token. The server keeps each
user's token in an in-memory session tied to an HttpOnly cookie. When a token expires (about every
16 hours), the server signs in again on its own if "Keep me signed in" was ticked. The server also
follows the pagination, caches each response for 4 seconds, and answers `304 Not Modified` when
nothing has changed.

## Sign in

1. **Company key** (for example `glenmark`): the server looks up the company instance, API URL and logo.
2. **Username and password**: the server signs in to that instance and keeps the token.

The login screen also has **Use a token instead** (paste an `authorization` header from DevTools)
and **Explore with demo data**. **Sign out** is in the account panel (the gear icon or the user card
at the bottom left).

## Reports

| Page | What it answers |
|---|---|
| **Overview** | 8 KPIs: availability, OOS, visits, orders, strike rate, SKUs per visit, well-stocked visits, active reps. Trends, brand and outlet-type donuts, a top-SKU chart and a live feed of the latest visits |
| **SKU availability** | Availability by category and brand, a region × category heatmap (any dimension), the lowest-availability SKUs, an OOS chart and an SKU scorecard |
| **Outlets** | Availability bands, outlet type and class, and an outlet scorecard with the missing SKUs from each outlet's latest visit |
| **Field team** | Orders by rep, a visits vs availability scatter, a rep leaderboard, a team summary and a daily coverage heatmap |
| **Geography** | Region, cluster, territory, state, city and RSM breakdowns |
| **Opportunities** | Auto-generated insights, each with a suggested action, plus a restock list, an upsell list (in stock but not ordered) and stock movement |
| **Pivot builder** | Any metric by any two dimensions |
| **Data explorer** | Every raw row, with a column picker, sorting and CSV export |

Every table can be sorted, filtered and exported to CSV. Clicking a chart bar, a donut slice or a
table row filters the whole dashboard. Filters are cross-filtered, so each dropdown only shows
values that exist under the other filters. Changing the date range calls the API again. The
dashboard has light and dark themes and a mobile layout.

**Metric definitions:** availability % = checks with `avail > 0` / all checks · visit = one
`session_id` · strike rate = visits with any `o_qty > 0` / visits · well-stocked visit = at least 80%
of SKUs on shelf.

## Run in VS Code

1. Install [Node.js 18+](https://nodejs.org) and open this folder in VS Code.
2. Open a terminal and run `npm install`.
3. Optional: copy `.env.example` to `.env`. The defaults work as they are.
4. Press **F5** and choose "Shelfwise: live" (or "demo data"). The browser opens at
   http://localhost:8080 on the sign-in screen.

You can also run `npm run dev`, or `npm run demo` for demo data with no login.

## Run with Docker

```bash
cp .env.example .env        # optional
docker compose up -d --build
# open http://localhost:8080
```

To use a different host port, run `HOST_PORT=9000 docker compose up -d`. To stop it, run `docker compose down`.

## Making it public (a URL anyone can open)

There are two ways. Choose based on whether the dashboard has to be **live**:

### A) Live, every 5 s: host the Docker container (recommended)

Deploy the Docker image to any host that runs containers, such as Render, Railway, Fly.io, a VPS or
an office server. Anyone can open the URL, but they only see data after signing in with their own
SalesDiary account. Serve it over **HTTPS** (all of these hosts do), because passwords are sent to
the server. For an extra gate in front of the login screen, set `DASHBOARD_USER` and
`DASHBOARD_PASSWORD`.

### B) GitHub Pages: static snapshot, not live

`.github/workflows/pages.yml` builds a static copy of the dashboard and publishes it to
`https://<user>.github.io/<repo>/`. The page detects that there is no server behind it and reads
`data/report.json` instead. Limits:

- GitHub Pages only serves files, so it cannot refresh every 5 s. The workflow rebuilds about
  every 30 minutes, and GitHub often runs scheduled workflows late.
- There is no login. **By default it publishes demo data.** To publish real numbers, add the
  repository secrets `SD_COMPANY_KEY`, `SD_USERNAME` and `SD_PASSWORD`, and the repository variable
  `PAGES_LIVE_DATA=true`. Each build signs in, so the token never goes stale. Those numbers are
  then **public to anyone who has the URL**.

To enable it, go to Settings → Pages → Source and choose **GitHub Actions**. Then push to `main`
or run the workflow manually. To build locally, run `npm run build:static`; the output goes to `dist/`.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `REQUIRE_LOGIN` | `true` | Each viewer signs in. If `false`, everyone sees `SD_TOKEN` data (or demo data) |
| `SD_COMPANY_KEY` | — | Pre-fills the company key on the login screen |
| `SESSION_HOURS` | `12` | How long an idle session stays signed in |
| `SD_LOGIN_BASE` | `https://sdlogin.salesdiary.in:2001` | Company lookup host |
| `SD_PWA_VERSION` | `293` | `pwa_version` sent with the login |
| `SD_TOKEN` | — | Shared token, only used when `REQUIRE_LOGIN=false` |
| `SD_API_BASE` | `https://inx11.salesdiary.in:4071` | Fallback API host (the company lookup normally provides it) |
| `SD_PAGE_SIZE` | `5000` | Rows per call (`offset` in the request) |
| `SD_PAGINATION` | `id` | How the next page is requested: `id` (offsetID = last row id), `offset` (offsetID = row count) or `none` |
| `DATA_SOURCE` | `auto` | `auto`, `live` or `mock` |
| `CACHE_TTL_MS` | `4000` | How long an upstream response is reused |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | — | Extra browser password prompt in front of everything |
| `ALLOW_TOKEN_UPDATE` | `true` | Allow token sign-in and token replacement in the UI |

## Project layout

```
server.js              HTTP server: static files, /api/auth/*, /api/report, /api/status
src/upstream.js        SalesDiary calls: company lookup, login, report pagination
src/sessions.js        in-memory sessions (HttpOnly cookie) and login rate limiting
src/mock.js            demo data in the same shape as the API
src/columnar.js        flattens rows and sends them column-wise (small payloads)
public/                the dashboard and sign-in screen: plain HTML, CSS and ES modules, with Chart.js
scripts/build-static.js  static build for GitHub Pages
```
