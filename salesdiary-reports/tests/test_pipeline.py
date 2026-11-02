import io
import json
import os
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIX = ROOT / "tests" / "fixtures"
if not (FIX / "sample_response.json").exists():
    import subprocess
    subprocess.run([sys.executable, str(FIX / "make_sample.py")], check=True)
ROWS = json.loads((FIX / "sample_response.json").read_text())["results"]["data"]["sales"]

from app import fetcher as fm  # noqa: E402
from app import config  # noqa: E402

TOKEN = "header.eyJkYXRhIjp7fX0.signature-for-tests-only"


class FakeResp:
    def __init__(self, status=200, body=None, text=None):
        self.status_code, self._body, self.text = status, body, text if text is not None else json.dumps(body)

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    """Simulates the SalesDiary API with row- or page-based offsets."""
    def __init__(self, rows, page_size=37, mode="row", overlap=0, fail=None, repeat_last=False):
        self.rows, self.ps, self.mode, self.overlap, self.fail, self.repeat_last, self.calls = rows, page_size, mode, overlap, fail, repeat_last, []

    def post(self, url, headers=None, data=None, timeout=None, verify=None):
        body = json.loads(data)
        assert headers["authorization"] == body["access_token"] == TOKEN
        assert headers["Accept"].endswith("*/*")
        off = body["offset"]; self.calls.append(off)
        if self.fail: return self.fail
        start = off if self.mode == "row" else off * self.ps
        start = max(0, start - self.overlap) if off > 1 else start
        page = self.rows[start:start + self.ps]
        if not page and self.repeat_last:
            page = self.rows[-self.ps:]
        return FakeResp(body={"results": {"status": 200, "msg": "success", "data": {"sales": page}}})


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(config, "MAX_RETRIES", 1)
    monkeypatch.setattr(fm.time, "sleep", lambda s: None)


@pytest.mark.parametrize("mode", ["row", "page"])
def test_fetch_all_rows_both_offset_modes(mode):
    s = FakeSession(ROWS, mode=mode)
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()
    assert res.offset_mode == mode
    assert len(res.rows) == len(ROWS)


def test_identical_rows_are_kept_not_deduplicated():
    """Same SKU punched twice in one order is real sale; it must survive pagination (also across a page boundary)."""
    dup = dict(ROWS[0])
    data = ROWS[:36] + [dup, dict(dup)] + ROWS[36:]      # duplicate pair straddles the 37-row page boundary
    for mode in ("row", "page"):
        res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=FakeSession(data, mode=mode)).run()
        assert len(res.rows) == len(data), mode
        assert sum(float(str(r["total"]).replace(",", "")) for r in res.rows) == pytest.approx(
            sum(float(str(r["total"]).replace(",", "")) for r in data))


def test_server_repeating_last_page_does_not_loop_forever():
    s = FakeSession(ROWS, mode="page", repeat_last=True)
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()
    assert len(res.rows) == len(ROWS)
    assert len(s.calls) < 100


def test_expired_token_message():
    s = FakeSession(ROWS, fail=FakeResp(401, {"msg": "unauthorized"}))
    with pytest.raises(fm.FetchError, match="expired"):
        fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()


def test_html_instead_of_json():
    s = FakeSession(ROWS, fail=FakeResp(200, None, "<html>login</html>"))
    with pytest.raises(fm.FetchError, match="JSON"):
        fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()


def test_body_status_error():
    s = FakeSession(ROWS, fail=FakeResp(200, {"results": {"status": 500, "msg": "db error"}}))
    with pytest.raises(fm.FetchError, match="db error"):
        fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()


def test_server_error_retried_then_reported():
    s = FakeSession(ROWS, fail=FakeResp(502, {"x": 1}))
    with pytest.raises(fm.FetchError, match="Gave up"):
        fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()


def test_short_token_rejected():
    with pytest.raises(fm.FetchError):
        fm.Fetcher("abc", "2026-10-01", "2026-10-31")


def test_api_ignoring_offset_is_an_error_not_silent_truncation():
    class Same(FakeSession):
        def post(self, url, headers=None, data=None, timeout=None, verify=None):
            return FakeResp(body={"results": {"status": 200, "data": {"sales": self.rows[:37]}}})
    with pytest.raises(fm.FetchError, match="ignores"):
        fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=Same(ROWS)).run()


def test_empty_range():
    s = FakeSession([], mode="row")
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()
    assert res.rows == []


def test_master_reader_flags_store_id_targets():
    from app import master
    df = pd.DataFrame([["S.No", "SD Store ID", "Account Name", "KAE/ASM", "Target", "Channel Name"],
                       [1, "MTDM5703", "DMart", "Sylvester Kishor", 5703, "MT"],
                       [2, "MTHG20", "H&G", "Sylvester Kishor", 80000, "MT"],
                       [3, "SAZE66", "SAMT", "Jitendra Dhayatkar", 500, "SAMT"]])
    buf = io.BytesIO(); df.to_excel(buf, header=False, index=False)
    pos, notes = master.read_master(buf.getvalue(), "roster.xlsx")
    assert list(pos["target"]) == [0, 80000, 0]
    assert pos["target_flag"].iloc[0].startswith("Target = store")
    st = master.store_level(pos)
    assert set(st["cust_code"]) == {"MTDM5703", "MTHG20", "SAZE66"}


@pytest.fixture(scope="module")
def pipeline():
    from app import spark_clean, report, master
    df = pd.DataFrame([["SD Store ID", "Account Name", "KAE/ASM", "Target", "Channel Name"],
                       ["MTHG20", "H&G", "Sylvester Kishor", 200000, "MT"],
                       ["MTDM5703", "DMart", "Sylvester Kishor", 300000, "MT"],
                       ["NOSALE1", "DMart", "Nagesh", 50000, "MT"]])
    buf = io.BytesIO(); df.to_excel(buf, header=False, index=False)
    pos, _ = master.read_master(buf.getvalue(), "m.xlsx")
    res = spark_clean.clean(ROWS, "2026-10-01", "2026-10-31", master.store_level(pos))
    return report.enrich(res, "2026-10-01", "2026-10-31")


def test_no_leakage_every_total_ties(pipeline):
    raw_total = sum(float(str(r.get("total") or 0).replace(",", "")) for r in ROWS)
    assert len(pipeline["clean"]) == len(ROWS)                       # duplicates inside a page are kept + flagged, not dropped
    assert pipeline["clean"]["total"].sum() == pytest.approx(raw_total)
    assert all(c["result"] == "OK" for c in pipeline["checks"]), pipeline["checks"]


def test_edge_case_flags(pipeline):
    q = set(pipeline["quality"]["issue"])
    for issue in ("Date outside requested range", "Missing salesman code", "Zero / negative amount",
                  "Order lines do not add up to order total", "Possible duplicate line (same order, SKU, qty, amount)",
                  "Region does not match state"):
        assert issue in q, issue
    assert len(pipeline["order_gaps"]) >= 1


def test_master_target_and_unmapped(pipeline):
    t = pipeline["target_kae"]
    assert "Not in master (unmapped sale)" in set(t["kae"])
    assert t["achievement"].sum() == pytest.approx(pipeline["clean"]["total"].sum())
    assert "NOSALE1" in set(pipeline["stores_no_sale"]["cust_code"])


def test_excel_and_json(pipeline, tmp_path):
    from app import report
    meta = dict(start="2026-10-01", end="2026-10-31", generated="now", rows=len(ROWS), fetch={"Pages": 3}, master=True)
    p = tmp_path / "r.xlsx"; report.write_excel(pipeline, meta, p)
    import openpyxl
    wb = openpyxl.load_workbook(p)
    for name in ("Dashboard", "Control Checks", "KAE Summary", "Supervisor Summary", "Promoters", "Outlets", "Clean Data",
                 "Target vs Achievement", "Data Quality", "Order Gaps"):
        assert name in wb.sheetnames
    js = report.dashboard_json(pipeline, meta)
    json.dumps(js)   # must be serialisable (no NaN / numpy types)
    assert js["kpi"]["sales"] > 0 and js["insights"]
