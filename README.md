# Shelfwise — live stock availability reporting

Shelfwise turns the SalesDiary `getStockAvailablityReport` data into a reporting website. It covers
shelf availability, outlets, field team performance, geography and a list of next actions. It
refreshes every 5 seconds.

It has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Website** (UI) | GitHub Pages: `https://safdarnwz.github.io/ticketly/` | Reports, charts, filters, sign-in screen |
| **Server** (backend) | Docker on your own computer: `http://localhost:8080` | Signs in to SalesDiary, keeps the token, fetches and caches the report |

```
 GitHub Pages website  ──(your browser, every 5 s)──▶  Shelfwise server in Docker (localhost:8080)
                                                          │  company key → findcompanyinstancewithlogo
                                                          │  username/password → instance_pwa_login → token
                                                          └▶ getStockAvailablityReport (paginated, cached 4 s)
```

Your browser fetches the data from the server on your own machine. Nothing is sent to GitHub, and
the SalesDiary token never reaches the browser.

## 1. Start the server (Docker)

```bash
git clone https://github.com/safdarnwz/ticketly && cd ticketly
docker compose up -d --build
```

The server listens only on this computer, at `127.0.0.1:8080`. Opening http://localhost:8080
shows a short page with a link to the website. To stop it, run `docker compose down`.

## 2. Open the website

Go to **https://safdarnwz.github.io/ticketly/** and follow the three steps:

1. The site finds your server at `http://localhost:8080`. If the server isn't running, the site
   says so and shows a **Retry** button. Chrome and Edge may ask to allow access to
   *devices on your local network*. Choose **Allow**.
2. Enter the **company key** (for example `glenmark`). The server looks up the company, its logo
   and its API address.
3. Enter your **username and password**. The server signs in to SalesDiary and keeps the token.
   If you tick "Keep me signed in", the server renews the token on its own when it expires.

Also on the sign-in screen: **Use a token instead** (paste the `authorization` header from
DevTools), **Explore with demo data**, and **View the demo snapshot** (when no server is running).

> Use Chrome, Edge or Firefox. Safari may block an `https://` website from calling `http://localhost`.

### Publishing the website (one-time)

1. Merge this branch into `main`.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs on every push to `main`. You can also start it
   from the Actions tab. After about a minute the site is live at `https://safdarnwz.github.io/ticketly/`.

If your fork or username is different, set `CORS_ORIGINS` in `.env` to that Pages origin. If the
server runs on a different address, set the repository variable `PAGES_SERVER_URL` before the build.
Each visitor can also change the server address on the site.

## Reports

| Page | What it answers |
|---|---|
| **Overview** | One written summary of the day, 8 KPIs, availability trend, visits and orders per day, brand and outlet-type split, best sellers and the latest visits |
| **SKUs** | Availability by category and brand, a "where each line is missing" heatmap, the hardest SKUs to find, an out-of-stock chart and an SKU scorecard |
| **Outlets** | Availability bands, outlet type and class, and an outlet scorecard with the SKUs missing at each outlet's latest visit |
| **Field team** | Units by rep, visits vs availability, a rep leaderboard, a team summary and a daily coverage grid |
| **Geography** | Region, cluster, territory, state, city and RSM breakdowns |
| **Opportunities** | Ranked actions (which SKUs to fix first, critical outlets, upsell headroom, coaching), plus a restock list and an upsell list |
| **Pivot** | Any metric by any two dimensions |
| **Raw data** | Every record, with a column picker, sorting and CSV export |

Every table can be sorted, searched and exported to CSV. Clicking any bar, slice or row filters the
whole site, and filters are cross-filtered. The date range is passed to the API. The site has light
and dark themes and works on mobile.

**Metric definitions:** availability = checks with `avail > 0` / all checks · visit = one
`session_id` · strike rate = visits with any `o_qty > 0` / visits · well-stocked visit = at least 80%
of SKUs on shelf.

## Local development (VS Code)

```bash
npm install
npm run dev      # server + UI together at http://localhost:8080
npm run demo     # same, with generated demo data and no sign-in
npm run api      # server only, for use with the GitHub Pages site
```

You can also press **F5** in VS Code and pick a launch configuration.
`npm run build:static` builds the website into `dist/`, which is exactly what GitHub Pages serves.

## Configuration (`.env`, optional)

Copy `.env.example` to `.env`. Docker Compose reads it automatically.

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `https://safdarnwz.github.io` | Websites allowed to use this server (localhost is always allowed) |
| `DASHBOARD_URL` | `https://safdarnwz.github.io/ticketly/` | Link shown on the server's own page |
| `SERVE_UI` | `false` | Also serve the UI from the server (`--ui` does the same) |
| `REQUIRE_LOGIN` | `true` | Each viewer signs in. If `false`, everyone sees `SD_TOKEN` data (or demo data) |
| `SD_COMPANY_KEY` | — | Pre-fills the company key |
| `SESSION_HOURS` | `12` | How long an idle sign-in lasts |
| `SD_LOGIN_BASE` | `https://sdlogin.salesdiary.in:2001` | Company lookup host |
| `SD_API_BASE` | `https://inx11.salesdiary.in:4071` | Fallback API host (normally from the company lookup) |
| `SD_PWA_VERSION` | `293` | `pwa_version` sent at sign-in |
| `SD_PAGE_SIZE` / `SD_PAGINATION` | `5000` / `id` | Rows per call, and how the next page is requested (`id`, `offset` or `none`) |
| `CACHE_TTL_MS` | `4000` | How long one SalesDiary response is reused |
| `ALLOW_TOKEN_UPDATE` | `true` | Allow token sign-in and token replacement |

### The fallback snapshot on GitHub Pages

The website also ships `data/report.json`, which is shown when "View the demo snapshot" is chosen.
It contains **demo data** unless you add the repository secrets `SD_COMPANY_KEY`, `SD_USERNAME` and
`SD_PASSWORD` and the variable `PAGES_LIVE_DATA=true`. With those set, real numbers are published,
and **anyone with the URL can see them**.

## Project layout

```
server.js                HTTP server: /api/auth/*, /api/report, /api/status, CORS
src/upstream.js          SalesDiary calls: company lookup, login, report pagination
src/sessions.js          in-memory sessions (X-Session header or cookie), login rate limiting
src/mock.js              demo data in the API's exact shape
src/columnar.js          compact column-wise payloads for 5-second polling
public/                  the website: HTML, CSS, ES modules, Chart.js
public/js/backend.js     finds the local server and talks to it
scripts/build-static.js  builds the website for GitHub Pages
```
