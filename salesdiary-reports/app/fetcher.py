"""Pull every row of the SalesDiary tertiary sales report for a date range.

How the API behaves (found on the live system)
- "offset" in the request body is the browser's time-zone offset in minutes (330 = IST, +5:30), NOT a page number.
  The API returns the whole date range in one response; sending offset 0/1 just returns the same rows.
- So the fetcher sends offset=330 (SD_TZ_OFFSET) like the web app, and reads the whole range in one call.

Edge cases handled
- Possible server-side row cap: if one response returns a "round" number of rows (e.g. 500, 1000, 5000) the range is
  re-fetched day by day and the per-day results are used (each day's rows must belong to that day). SD_FETCH_MODE=daily
  always fetches day by day; single never does.
- Rows are never de-duplicated (identical lines can be genuine sale); they are flagged later instead.
- Expired / wrong token (401/403 or a token message in the body), HTML error pages, timeouts, 5xx and 429 give clear
  messages; transient errors are retried with backoff.
- The token is only held in memory for the duration of the fetch. It is never logged or written to disk.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import requests

from . import config


class FetchError(Exception):
    pass


@dataclass
class FetchResult:
    rows: list
    pages: int
    offset_mode: str           # how the data was fetched (kept name for compatibility)
    raw_rows: int              # rows received incl. overlap duplicates
    overlap_dropped: int       # day-by-day mode: rows skipped because their date belongs to another day's call
    page_sizes: list = field(default_factory=list)


def build_payload(token: str, start: str, end: str, offset: int | None = None) -> dict:
    """Body exactly as the SalesDiary web app sends it; only dates and token change. offset = time-zone minutes."""
    offset = config.TZ_OFFSET if offset is None else offset
    return {
        "start_date": start, "end_date": end, "period_id": 0, "access_token": token,
        "url": config.API_BASE, "offset": offset, "offsetID": 0, "flag": True, "type": "",
        "start_hr": None, "end_hr": None, "asset_id": None, "applyDate": False,
        "filterData": {
            "date": None, "access_token": None, "url": None, "last_date": None, "offset": None, "flag": True,
            "out_type": -1, "salesman_id": 0, "policyID": 0, "outlet_type": 0, "travel_type_id": 0,
            "class_type": None, "program_type": 0, "status": None, "max_claim": False, "trax_outlet": False,
            "non_trax_outlet": False, "exclude_trax_audit": False, "region_id": 0, "cluster_id": 0,
            "team_id": 0, "territory_id": 0, "dc_id": 0, "displayData": [], "payment_mode": "",
            "active": True, "inf_type_ids": [],
        },
        "customFilter": {}, "searchableFilter": None,
    }


def headers(token: str) -> dict:
    return {
        "authorization": token,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Referer": config.REFERER,
        "User-Agent": config.USER_AGENT,
    }


def extract_rows(body: dict) -> list:
    res = body.get("results", body) if isinstance(body, dict) else {}
    status = res.get("status", 200)
    if status not in (200, "200", None):
        raise FetchError(f"SalesDiary returned status {status}: {res.get('msg')}")
    data = res.get("data") or {}
    rows = data.get("sales") if isinstance(data, dict) else None
    if rows is None:
        raise FetchError("Response has no results.data.sales list – the report format may have changed.")
    return rows


def signature(row: dict) -> str:
    return json.dumps(row, sort_keys=True, ensure_ascii=False, default=str)


class Fetcher:
    def __init__(self, token: str, start: str, end: str, session: Optional[requests.Session] = None,
                 progress: Optional[Callable[[dict], None]] = None, raw_sink: Optional[Callable[[int, list], None]] = None):
        if not token or len(token.strip()) < 20:
            raise FetchError("Token is empty or too short. Paste the full 'authorization' value from SalesDiary.")
        self.token = token.strip().removeprefix("Bearer ").strip()
        self.start, self.end = start, end
        self.session = session or requests.Session()
        self.progress = progress or (lambda d: None)
        self.raw_sink = raw_sink or (lambda i, rows: None)
        self.url = config.API_BASE + config.TERTIARY_PATH

    def _post(self, start: str | None = None, end: str | None = None) -> list:
        start, end = start or self.start, end or self.end
        last = None
        for attempt in range(config.MAX_RETRIES + 1):
            try:
                r = self.session.post(self.url, headers=headers(self.token),
                                      data=json.dumps(build_payload(self.token, start, end)),
                                      timeout=config.REQUEST_TIMEOUT, verify=config.VERIFY_TLS)
            except requests.RequestException as e:
                last = f"network error: {e.__class__.__name__}"
            else:
                if r.status_code in (401, 403):
                    raise FetchError("Token rejected (HTTP %s). It has probably expired – log in to SalesDiary again "
                                     "and copy a fresh token." % r.status_code)
                if r.status_code >= 500 or r.status_code == 429:
                    last = f"HTTP {r.status_code}"
                elif r.status_code != 200:
                    raise FetchError(f"HTTP {r.status_code} from SalesDiary: {r.text[:200]}")
                else:
                    try:
                        body = r.json()
                    except ValueError:
                        raise FetchError("SalesDiary did not return JSON (got %r…). Check the URL / token." % r.text[:80])
                    msg = str((body.get("results") or {}).get("msg", "")).lower() if isinstance(body, dict) else ""
                    if any(w in msg for w in ("expired", "invalid token", "unauthor")):
                        raise FetchError(f"Token problem: {msg}")
                    return extract_rows(body)
            if attempt < config.MAX_RETRIES:
                time.sleep(min(2 ** (attempt + 1), 30))
        raise FetchError(f"Gave up after {config.MAX_RETRIES + 1} attempts for {start} to {end}: {last}")

    @staticmethod
    def looks_capped(n: int) -> bool:
        """A response that stops at a round number of rows may have been cut by the server."""
        return n >= 500 and (n % 500 == 0 or n in config.SUSPECT_CAPS)

    def _daily(self) -> tuple[list, list, int]:
        import datetime as _dt
        s, e = _dt.date.fromisoformat(self.start), _dt.date.fromisoformat(self.end)
        rows, sizes, outside = [], [], 0
        d, i, n_days = s, 0, (e - s).days + 1
        while d <= e:
            day = d.isoformat()
            page = self._post(day, day)
            self.raw_sink(i, page); sizes.append(len(page))
            if self.looks_capped(len(page)):
                raise FetchError(f"{day}: the API returned exactly {len(page)} rows for a single day, which looks like a server "
                                 "limit. The report would be incomplete – ask SalesDiary about the row limit.")
            for r in page:
                od = str(r.get("order_date") or "")[:10]
                if od and od != day:
                    outside += 1          # belongs to another day; it is fetched with that day
                    continue
                rows.append(r)
            i += 1; d += _dt.timedelta(days=1)
            self.progress({"stage": "fetch", "pages": i, "rows": len(rows), "note": f"day {i}/{n_days}"})
        return rows, sizes, outside

    def run(self) -> FetchResult:
        mode = config.FETCH_MODE
        if mode == "daily":
            rows, sizes, outside = self._daily()
            return FetchResult(rows, len(sizes), "day by day", sum(sizes), outside, sizes)
        rows = self._post()
        self.raw_sink(0, rows)
        self.progress({"stage": "fetch", "pages": 1, "rows": len(rows)})
        if mode == "auto" and self.looks_capped(len(rows)) and self.start != self.end:
            self.progress({"stage": "fetch", "pages": 1, "rows": len(rows), "note": f"{len(rows)} rows looks like a limit – re-fetching day by day"})
            drows, sizes, outside = self._daily()
            if len(drows) < len(rows):
                raise FetchError(f"Day-by-day fetch returned fewer rows ({len(drows)}) than the single call ({len(rows)}); "
                                 "cannot be sure the data is complete.")
            return FetchResult(drows, len(sizes) + 1, f"day by day (single call stopped at {len(rows)} rows)", sum(sizes), outside, sizes)
        return FetchResult(rows, 1, "single call (offset = time-zone 330)", len(rows), 0, [len(rows)])
