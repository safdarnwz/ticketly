"""Pull every row of the SalesDiary tertiary sales report for a date range.

Edge cases handled
- "offset" may be a row offset or a page number: detected automatically (or forced with SD_OFFSET_MODE).
- Repeated pages: a page identical to an earlier page stops the loop (server looping). Individual rows are never
  de-duplicated, because identical lines can be genuine sale; they are flagged later instead.
- A server that ignores "offset" raises an error instead of silently returning only the first page.
- Expired / wrong token (401/403 or status != 200 in the body), HTML error pages, timeouts and 5xx are reported
  with a clear message; transient errors are retried with exponential backoff.
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
    offset_mode: str
    raw_rows: int              # rows received incl. overlap duplicates
    overlap_dropped: int       # pages ignored because they exactly repeated an earlier page
    page_sizes: list = field(default_factory=list)


def build_payload(token: str, start: str, end: str, offset: int) -> dict:
    """Body exactly as the SalesDiary web app sends it; only dates, token and offset change."""
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

    def _post(self, offset: int) -> list:
        last = None
        for attempt in range(config.MAX_RETRIES + 1):
            try:
                r = self.session.post(self.url, headers=headers(self.token),
                                      data=json.dumps(build_payload(self.token, self.start, self.end, offset)),
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
        raise FetchError(f"Gave up after {config.MAX_RETRIES + 1} attempts at offset {offset}: {last}")

    def run(self) -> FetchResult:
        """Rows are NEVER de-duplicated here: two identical lines can be genuine (same SKU punched twice) and dropping
        them would lose sale. Row offsets advance by exactly the rows received, so pages cannot overlap; a page that is
        an exact repeat of an earlier page means the server is looping, and fetching stops there."""
        rows, sizes, page_sigs = [], [], set()
        repeated = 0

        def page_sig(page):
            return hash(tuple(signature(r) for r in page))

        first = self._post(0)
        self.raw_sink(0, first); sizes.append(len(first)); rows.extend(first); page_sigs.add(page_sig(first))
        self.progress({"stage": "fetch", "pages": 1, "rows": len(rows)})
        if not first:
            return FetchResult([], 1, "n/a", 0, 0, sizes)

        mode = config.OFFSET_MODE
        if mode == "auto":
            probe = self._post(1)
            if not probe:
                return FetchResult(rows, 1, "single page", len(rows), 0, sizes)
            if [signature(x) for x in probe] == [signature(x) for x in first]:
                raise FetchError("The API returned the same page for offset 0 and 1, i.e. it ignores 'offset'. Only "
                                 f"{len(first)} rows could be read, so the report would be incomplete. Set SD_OFFSET_MODE "
                                 "or check the request.")
            if len(first) > 1 and signature(probe[0]) == signature(first[1]):
                mode = "row"          # offset=1 skipped exactly one row -> row offset
            else:
                mode = "page"         # offset=1 returned a different block -> page number
                self.raw_sink(1, probe); sizes.append(len(probe)); rows.extend(probe); page_sigs.add(page_sig(probe))
                if len(probe) < len(first):   # second page already short -> it was the last page
                    return FetchResult(rows, 2, mode, len(rows), 0, sizes)

        pages = len(sizes)
        offset = len(rows) if mode == "row" else pages
        while pages < config.MAX_PAGES:
            page = self._post(offset)
            pages += 1
            self.raw_sink(pages - 1, page); sizes.append(len(page))
            if not page:
                break
            sig = page_sig(page)
            if sig in page_sigs:      # exact repeat of an earlier page -> server is looping; stop
                repeated += 1
                break
            page_sigs.add(sig); rows.extend(page)
            self.progress({"stage": "fetch", "pages": pages, "rows": len(rows)})
            if len(page) < len(first):   # a short page is the last page; asking again could return repeated rows
                break
            offset = offset + len(page) if mode == "row" else offset + 1
        else:
            raise FetchError(f"Stopped after {config.MAX_PAGES} pages – raise SD_MAX_PAGES if this range is really that big.")
        return FetchResult(rows, pages, mode, sum(sizes), repeated, sizes)
