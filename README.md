# Shelfwise — live stock availability reporting

Shelfwise turns the SalesDiary `getStockAvailablityReport` data into a reporting website. It covers
shelf availability, outlets, field team performance, geography and a list of next actions. It
refreshes every 5 seconds.

It has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Website** (UI) | GitHub Pages: `https://safdarnwz.github.io/ticketly/` | Token box, reports, charts, filters |
| **Server** (backend) | Docker on your own computer: `http://localhost:8080` | Keeps your token, fetches and caches the report from SalesDiary |

```
 Website  ──token box──▶  Shelfwise server in Docker (localhost:8080)
          ──every 5 s──▶       └▶ getStockAvailablityReport with your token (paginated, cached 4 s)
```

Your browser fetches the data from the server on your own machine. Nothing is sent to GitHub.

## 1. Start the server (Docker)

```bash
git clone https://github.com/safdarnwz/ticketly && cd ticketly
docker compose up -d --build
```

The server listens only on this computer, at `127.0.0.1:8080`. Opening http://localhost:8080
shows a short page with a link to the website. To stop it, run `docker compose down`.

## 2. Open the website and paste your token

Open **https://safdarnwz.github.io/ticketly/**. If you set `SERVE_UI=true` or run `npm run dev`,
you can open **http://localhost:8080** instead.

1. Copy your SalesDiary token. Open app.salesdiary.in, press **F12** and go to **Network**. Click any
   API request (for example `getStockAvailablityReport`) and copy the value of the
   **`authorization`** request header (it starts with `eyJ…`).
2. Paste it into the **SalesDiary token** box at the top of the page (the token stays visible so
   you can check it) and press **Load data**. Nothing is sent until you press the button.

The box then shows the instance, the profile and when the token expires. A token lasts about
16 hours. When it expires, the box turns red; paste a fresh token. **Remove token** is in the account
menu (top right). **Or try demo data** loads generated numbers without a token.

If the server isn't running, the website asks you to start it and shows a **Retry** button.
Chrome and Edge may ask to allow access to *devices on your local network*. Choose **Allow**.

> Use Chrome, Edge or Firefox. Safari may block an `https://` website from calling `http://localhost`.

## Open the website on any computer (ngrok, permanent address)

The website looks for the server at `http://localhost:8080` on **the computer it is opened on**.
To make `https://safdarnwz.github.io/ticketly/` work on every laptop and phone while the code
keeps running on yours, give your server a permanent public address with ngrok (free):

1. Sign up at https://dashboard.ngrok.com/signup.
2. Copy your **authtoken** from https://dashboard.ngrok.com/get-started/your-authtoken.
3. Copy your free **dev domain** from https://dashboard.ngrok.com/domains (it looks like
   `something.ngrok-free.app`).
4. Add both to `.env` on your laptop:
   ```
   NGROK_AUTHTOKEN=your-authtoken
   NGROK_URL=something.ngrok-free.app
   ```
5. Start the server together with ngrok:
   ```bash
   docker compose --profile ngrok up -d --build
   docker compose logs ngrok        # look for: started tunnel ... url=https://something.ngrok-free.app
   ```
6. Put the same domain in **`site.config.json`** in this repository and push it (or edit the file
   on GitHub):
   ```json
   { "publicServer": "https://something.ngrok-free.app" }
   ```
   The Pages workflow republishes the site. From then on the plain website URL works anywhere.

How the website picks a server:
- On your own laptop it uses `localhost` (fast, and it doesn't count towards ngrok's limits).
- Everywhere else it uses the ngrok address.
- If your laptop ends up on the ngrok address anyway, open the account menu and choose
  **Use this computer's server**.

**ngrok free plan limits:** 20,000 requests and 1 GB per month. Through ngrok the website refreshes
**every 2 minutes** by default instead of every 5 seconds, so the quota lasts the month. You can
change this in the refresh menu, but 5 seconds would use up the quota in about a day. For heavier
use, take a paid ngrok plan or use Tailscale Funnel.

Your laptop must be on, with Docker running. Anyone with the URL reaches your server, but they
still need their own SalesDiary token to see any data.

## Using the website on other laptops or phones (temporary link)

The website looks for the server at `http://localhost:8080` on **the computer it is opened on**.
On another laptop there is no server, so it shows "Connect to a Shelfwise server". To use one
server (on your laptop) from anywhere, give it a public https address with the bundled tunnel:

```bash
docker compose --profile share up -d --build
docker compose logs shelfwise
#  Public server address: https://something.trycloudflare.com
#  Open on any computer:  https://safdarnwz.github.io/ticketly/?server=https://something.trycloudflare.com
```

Open that **"Open on any computer"** link on the other laptop. The website remembers the server,
and each person pastes their own SalesDiary token. The same link is shown in the account menu
(top right → *Open on another computer → Copy*).

- This uses a free Cloudflare "quick tunnel" and needs no account. Its address **changes every
  time the tunnel restarts**, so share the new link after a restart. For a permanent address, use
  the ngrok setup above.
- Your laptop must stay on, with Docker running, for the other computers to get data.
- To stop sharing, run `docker compose --profile share down`, then `docker compose up -d` to keep
  only the local server.

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

Every action you take (loading a token, changing the date range, applying a filter, switching
pages, refreshing) shows a spinner until the data is ready. The automatic 5-second refresh runs
quietly in the background. Every table can be sorted, searched and exported to CSV. Clicking any bar, slice or row filters the
whole site, and filters are cross-filtered. The date range is passed to the API. The site has light
and dark themes and works on mobile.

**Metric definitions:** availability = checks with `avail > 0` / all checks · visit = one
`session_id` · strike rate = visits with any `o_qty > 0` / visits · well-stocked visit = at least 80%
of SKUs on shelf.

## Local development (VS Code)

```bash
npm install
npm run dev      # server + UI together at http://localhost:8080
npm run demo     # same, with generated demo data and no token
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
| `NGROK_AUTHTOKEN` / `NGROK_URL` | — | ngrok authtoken and free dev domain, used by `docker compose --profile ngrok` |
| `PUBLIC_URL` | — | Public https address of this server. Leave empty with the `share` tunnel, which reports its own |
| `REQUIRE_TOKEN` | `true` | Each browser pastes its own token. If `false`, everyone sees `SD_TOKEN` data (or demo data) |
| `SD_TOKEN` | — | Shared token, only used when `REQUIRE_TOKEN=false` |
| `SESSION_HOURS` | `12` | How long a pasted token stays active while idle |
| `SD_API_BASE` | `https://inx11.salesdiary.in:4071` | SalesDiary API host |
| `SD_PAGE_SIZE` / `SD_PAGINATION` | `5000` / `id` | Rows per call, and how the next page is requested (`id`, `offset` or `none`) |
| `CACHE_TTL_MS` | `4000` | How long one SalesDiary response is reused |
| `ALLOW_TOKEN_UPDATE` | `true` | Show the token box |

### The fallback snapshot on GitHub Pages

The website also ships `data/report.json`, which is shown when "View the demo snapshot" is chosen.
It contains **demo data** unless you add the repository secret `SD_TOKEN` and the variable
`PAGES_LIVE_DATA=true`. With those set, real numbers are published, and **anyone with the URL can
see them**.

## Project layout

```
server.js                HTTP server: /api/auth/token, /api/report, /api/status, CORS
src/upstream.js          SalesDiary report call and pagination
src/sessions.js          in-memory token sessions (X-Session header or cookie)
src/mock.js              demo data in the API's exact shape
src/columnar.js          compact column-wise payloads for 5-second polling
public/                  the website: HTML, CSS, ES modules, Chart.js
public/js/backend.js     finds the local server and talks to it
scripts/build-static.js  builds the website for GitHub Pages
```
