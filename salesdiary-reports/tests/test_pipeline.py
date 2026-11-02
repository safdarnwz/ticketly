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
ALL = json.loads((FIX / "sample_response.json").read_text())["results"]["data"]["sales"]
ROWS = [r for r in ALL if "2026-10-01" <= str(r["order_date"]) <= "2026-10-31" or not str(r["order_date"]).startswith("2026-09")]
PREV = [r for r in ALL if str(r["order_date"]).startswith("2026-09") and r not in ROWS]

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
    """Behaves like the live SalesDiary API: 'offset' is the time-zone (330) and the whole range comes back in one
    response. cap = optional server row limit to simulate truncation."""
    def __init__(self, rows, cap=None, fail=None):
        self.rows, self.cap, self.fail, self.calls = rows, cap, fail, []

    def post(self, url, headers=None, data=None, timeout=None, verify=None):
        body = json.loads(data)
        assert headers["authorization"] == body["access_token"] == TOKEN
        assert headers["Accept"].endswith("*/*")
        assert body["offset"] == 330                      # time-zone minutes, exactly like the web app
        self.calls.append((body["start_date"], body["end_date"]))
        if self.fail: return self.fail
        out = [r for r in self.rows if body["start_date"] <= str(r["order_date"])[:10] <= body["end_date"]]
        if self.cap: out = out[:self.cap]
        return FakeResp(body={"results": {"status": 200, "msg": "success", "data": {"sales": out}}})


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(config, "MAX_RETRIES", 1)
    monkeypatch.setattr(config, "FETCH_MODE", "auto")
    monkeypatch.setattr(fm.time, "sleep", lambda s: None)


IN_OCT = [r for r in ROWS if "2026-10-01" <= str(r["order_date"])[:10] <= "2026-10-31"]


def test_single_call_returns_whole_range():
    s = FakeSession(ROWS)
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()
    assert len(s.calls) == 1 and len(res.rows) == len(IN_OCT)


def test_capped_response_is_refetched_day_by_day():
    s = FakeSession(ROWS, cap=1000)                       # server silently stops at 1000 rows for the month
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=s).run()
    assert len(res.rows) == len(IN_OCT) > 1000
    assert "day by day" in res.offset_mode and len(s.calls) == 1 + 31


def test_daily_mode_and_cap_on_a_single_day(monkeypatch):
    monkeypatch.setattr(config, "FETCH_MODE", "daily")
    res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=FakeSession(ROWS)).run()
    assert len(res.rows) == len(IN_OCT)
    one_day = [dict(ROWS[0], order_date="2026-10-05") for _ in range(500)]
    with pytest.raises(fm.FetchError, match="server limit"):
        fm.Fetcher(TOKEN, "2026-10-05", "2026-10-05", session=FakeSession(one_day)).run()


def test_identical_rows_are_kept_not_deduplicated():
    """Same SKU punched twice in one order is real sale; it must survive (single call and day by day)."""
    dup = dict(IN_OCT[0])
    data = IN_OCT + [dict(dup), dict(dup)]
    for mode in ("single", "daily"):
        config.FETCH_MODE = mode
        res = fm.Fetcher(TOKEN, "2026-10-01", "2026-10-31", session=FakeSession(data)).run()
        assert len(res.rows) == len(data), mode
    config.FETCH_MODE = "auto"


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


def test_empty_range():
    res = fm.Fetcher(TOKEN, "2030-01-01", "2030-01-31", session=FakeSession(ROWS)).run()
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


@pytest.fixture(scope="module")
def act(pipeline):
    from app import spark_clean, actions
    prev = spark_clean.clean(PREV, "2026-09-01", "2026-09-30")
    return actions.build(pipeline["clean"], prev["clean"], "2026-10-01", "2026-10-31", None, pipeline.get("target_kae")), prev


def test_previous_period_dates():
    from app.actions import previous_period
    assert previous_period("2026-11-01", "2026-11-18") == ("2026-10-01", "2026-10-18")
    assert previous_period("2026-10-01", "2026-10-31") == ("2026-09-01", "2026-09-30")     # 31 -> 30
    assert previous_period("2026-03-01", "2026-03-31") == ("2026-02-01", "2026-02-28")
    assert previous_period("2026-01-05", "2026-01-20") == ("2025-12-05", "2025-12-20")


def test_actions_find_the_planted_problems(act):
    a, _ = act
    p = a["promoters"].set_index("emp_code")
    assert p.loc["GL1800019", "status"].startswith("Stopped")                       # sold in Sep, nothing in Oct
    assert {"GL1800003", "GL1800004"} <= set(a["no_sale"]["emp_code"])               # stopped after 26-Oct
    assert {"GL1800003", "GL1800004"} <= set(a["not_punched"]["emp_code"])
    assert "GL1800019" in set(a["drops"]["emp_code"])
    assert (a["suspicious"]["type"] == "Quantity spike").any()
    assert a["sku_gaps"]["cust_code"].is_unique                                     # one row per outlet, no double opportunity
    west = a["kae_scorecard"].set_index("kae").loc["KAE West"]
    assert west["change"] < 0 and west["rag"] in ("Red", "Amber")
    areas = {x["area"] for x in a["actions"]}
    assert {"Sale vs LMTD", "Punching", "Inactive promoters", "Promoter decline"} <= areas
    for x in a["actions"]:                                                          # every bullet names something concrete
        assert any(ch.isdigit() for ch in x["text"])


def test_action_totals_tie_to_raw(act, pipeline):
    from app import report
    a, prev = act
    checks = report.action_checks(a, pipeline, prev)
    assert all(c["result"] == "OK" for c in checks), checks


def test_excel_and_json(pipeline, act, tmp_path):
    from app import report
    a, prev = act
    meta = dict(start="2026-10-01", end="2026-10-31", lmtd_start="2026-09-01", lmtd_end="2026-09-30", generated="now",
                rows=len(ROWS), fetch={"Pages": 3}, master=True)
    pipeline["checks"] = pipeline["checks"] + report.action_checks(a, pipeline, prev)
    p = tmp_path / "r.xlsx"; report.write_excel(pipeline, a, meta, p)
    import openpyxl
    wb = openpyxl.load_workbook(p)
    for name in ("Action Center", "Control Checks", "KAE Scorecard", "Supervisor Scorecard", "Not Punched", "No Sale 3+ Days",
                 "Promoter Decline", "Outlet Decline", "Outlet SKU Gaps", "Entries To Verify", "Clean Data"):
        assert name in wb.sheetnames, name
    js = report.dashboard_json(pipeline, a, meta)
    json.dumps(js)
    assert js["actions"] and js["totals"]["lmtd"] > 0
