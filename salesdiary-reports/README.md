# SalesDiary Reports

Web app (Docker) that pulls the **SalesDiary tertiary sales report** for any date range, cleans it with **PySpark**, and
shows a full dashboard in the browser, with a matching **Excel** download.

```
Browser (HTML + JS + Chart.js)
   │  token + start/end date (+ optional roster/target master)
   ▼
FastAPI ──► fetcher.py ──► SalesDiary API (all pages)
              │  raw pages saved to /data/runs/<id>/raw (token is never saved)
              ▼
           spark_clean.py  (PySpark: types, trims, mapping, flags, aggregates)
              ▼
           report.py  ──► dashboard.json (web page)  +  Excel (16 sheets)  +  clean_data.csv
```

## Run

```bash
cd salesdiary-reports
cp .env.example .env
docker compose up -d --build
```

Open **http://localhost:8080**, paste the token, pick the dates and click **Fetch & build dashboard**.

### Where the token comes from
In Chrome: log in to app.salesdiary.in → F12 → **Network** → open any report → click the `tertiarySalesReport`
request → **Headers** → copy the `authorization` value. A token lasts about 16 hours. The page shows its expiry
time as soon as you paste it (decoded in the browser, nothing is sent anywhere).

## What you get – Sales Action Center

Open the report and the first screen tells you **who to call and what to fix today**. Every point names the person,
the outlet and the rupee impact:

| Action | What it finds |
|---|---|
| **Sale vs LMTD** | This period vs the same days last month, and which KAE / supervisor caused the change (₹) |
| **Not punched** | Promoters who sold in the period but punched nothing on the last day, with supervisor and usual daily sale |
| **No sale 3+ days** | Promoters inactive for N days (attendance / stock / replacement issue) |
| **Never punched** | Roster promoters (master upload) with zero sale punched |
| **Decline** | Promoters and outlets down 20%+ vs LMTD, incl. those that stopped completely; worst first |
| **SKU gaps** | Outlets not selling focus SKUs (sold in 40%+ of similar outlets) + ₹ opportunity per outlet |
| **Verify** | Quantity spikes, same SKU twice in one order, one promoter at several outlets on one day, below-MRP sale |
| **Scorecards** | KAE and supervisor: sale, LMTD, growth, target/ach (master), punched today, punch %, ₹/promoter-day, gaps, RAG |

* **Filters** (Channel → KAE → Supervisor) recalculate every tile, list and action point for that team.
* **Copy for WhatsApp** on every list, plus CSV.
* **Excel** has the same views: Action Center, Control Checks, KAE / Supervisor Scorecard, Not Punched, No Sale 3+ Days,
  Never Punched, Promoter / Outlet Decline, Outlet SKU Gaps, Focus SKUs, Entries To Verify, All Promoters / Outlets, Brand,
  Brand Mix Index, Daily Trend, Data Quality, Order Gaps and Clean Data.
* LMTD is fetched automatically (same days last month) when "Compare with LMTD" is ticked. Thresholds are set in `.env`.

## Optional master (exact accounts + targets)
Upload the *Attendance & Sale* workbook (any sheet whose header has `SD Store ID` and `Target`) or a CSV with
`cust_code, account, kae, supervisor, rsm, channel, target`. Tick **Remember** to reuse it on every run.
Without a master, the account comes from the store-code prefix (MTDM → DMart, MTLU → Lulu, SA… → SAMT …). Those rows
are marked `prefix rule`, and ambiguous prefixes (MTWE, MTCA) are flagged for review.

## No-leakage rules (edge cases handled)

| Risk | How it is handled |
|---|---|
| Pagination: `offset` may be a row offset or a page number | Detected automatically (`SD_OFFSET_MODE=auto`), or force `row` / `page` |
| API ignores `offset` and returns page 1 every time | Stops with an error instead of a silently partial report |
| Server repeats a page or loops | An exact repeat of a page stops the loop; a short page is treated as the last page |
| Identical lines (same SKU punched twice) | **Never dropped**. Kept and flagged "Possible duplicate line" |
| Lines of an order missing / extra | Sum of lines vs `order_config_json.order.total`, listed in **Order Gaps** |
| Numbers as text (`"1,234"`), text dates, blanks, `"NA"`, trailing spaces | Cast / trimmed in Spark; invalid values flagged |
| Expired / wrong token, HTML error page, HTTP 5xx / 429 | Clear message; 5xx and 429 retried with backoff |
| Target equal to store number (copy-paste error) or below ₹1,000 | Set to 0 and flagged (master) |
| Sale at a store missing from the master | Shown as "Not in master (unmapped sale)", never dropped |
| Stores in the master with no sale | Listed in "Stores without sale" |
| Every table must add up | Control Checks: rows and ₹ of every table vs Clean Data (web page + live Excel formulas) |

## Configuration (`.env`)
See `.env.example`: API base/path, timeout, retries, max pages, offset mode, max range (default 92 days), Spark memory.

## Security
* The token is sent only to this server, used for the fetch and then dropped. It is not logged and not written to disk,
  and the input box is cleared after submit.
* `.env` and `data/` are git-ignored. `data/` holds business data: keep it on the server.
* Run it on an internal machine, or put it behind your VPN / reverse-proxy auth if others will use it.

## Development

```bash
pip install -r requirements-dev.txt   # needs Java 17+ for PySpark
python tests/fixtures/make_sample.py  # synthetic sample response (anonymised)
pytest -q
python tests/mock_api.py &            # fake SalesDiary API on :4071 for end-to-end tests
SD_API_BASE=http://127.0.0.1:4071 DATA_DIR=./data uvicorn app.main:app --port 8080
```
