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

## What you get

**Dashboard (browser):** KPI tiles, insights, daily trend, brand mix, accounts, top teams, plus sortable and searchable tables:
KAE/Team, Supervisor, Promoters, Outlets, Brands/SKUs/Accounts/States, Target vs Achievement (when a master is uploaded),
Data quality, Order gaps and Control checks.

**Excel:** Dashboard, Control Checks (live formulas), KAE Summary, Supervisor Summary, Target vs Achievement, Stores
without sale, Promoters, Outlets, Brands, SKUs, Daily Trend (+ chart), Daily x Brand, Account Summary, Account x Brand,
State Summary, Data Quality, Order Gaps, Clean Data.

**History:** every run is kept in `./data/runs/` and can be opened again from the **History** tab.

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
