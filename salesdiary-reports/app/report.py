"""Turn the cleaned aggregates into (1) dashboard JSON for the web page and (2) a styled Excel workbook.
The page and the workbook are built from the same numbers, so they always match."""
from __future__ import annotations

import calendar
import datetime as dt
import math

import numpy as np
import pandas as pd
from openpyxl import Workbook

from . import actions as actions_mod
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L


# ------------------------------------------------------------------ derived tables
def _safe_div(a, b):
    return np.where(b == 0, np.nan, a / b.replace(0, np.nan)) if isinstance(b, pd.Series) else (a / b if b else np.nan)


def enrich(r: dict, start: str, end: str) -> dict:
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    total = float(r["kpi"].get("sales") or 0)
    for key in ("kae", "supervisor", "brand", "account", "state", "channel", "sku", "categ"):
        t = r[key]
        if len(t):
            t["share"] = t["sales"] / total if total else 0
            t["aov"] = _safe_div(t["sales"], t["orders"])
            t["lines_per_order"] = _safe_div(t["lines"], t["orders"])
    for key in ("kae", "supervisor"):
        t = r[key]
        if len(t):
            t["sales_per_promoter"] = _safe_div(t["sales"], t["promoters"])
            t["avg_active_days"] = _safe_div(t["promoter_days"], t["promoters"])
            t["sales_per_promoter_day"] = _safe_div(t["sales"], t["promoter_days"])
            t["rank"] = t["sales"].rank(ascending=False, method="min").astype(int)
    p = r["promoter"]
    if len(p):
        p["avg_per_active_day"] = _safe_div(p["sales"], p["active_days"])
        p["status"] = np.select([p["days_since_last_sale"] >= 7, p["days_since_last_sale"] >= 3, p["active_days"] <= 3],
                                ["Inactive 7+ days", "No sale last 3+ days", "Low activity (≤3 days)"], default="Active")
    o = r["outlet"]
    if len(o):
        o["status"] = np.select([o["days_since_last_sale"] >= 7, o["skus"] <= 2], ["No sale 7+ days", "Low assortment (≤2 SKUs)"], default="OK")
    d = r["daily"]
    if len(d):
        d["order_date"] = pd.to_datetime(d["order_date"])
        d["weekday"] = d["order_date"].dt.day_name()
        d["cum_sales"] = d["sales"].cumsum()
    # run-rate (only when range is inside one month)
    same_month = s.year == e.year and s.month == e.month
    dim = calendar.monthrange(e.year, e.month)[1]
    elapsed = (e - s).days + 1
    r["runrate"] = dict(same_month=same_month, days_in_month=dim, days_elapsed=elapsed,
                        expected_pct=(e.day / dim) if same_month and s.day == 1 else None,
                        projected=(total / elapsed * dim) if same_month and s.day == 1 and elapsed else None)
    if "target_kae" in r:
        t = r["target_kae"]
        t["ach_pct"] = _safe_div(t["achievement"], t["target"])
        exp = r["runrate"]["expected_pct"]
        t["expected_pct"] = exp
        t["gap_vs_plan"] = t["achievement"] - t["target"] * (exp or 0) if exp else np.nan
        t["required_per_day"] = ((t["target"] - t["achievement"]).clip(lower=0) / max(dim - e.day, 1)) if exp else np.nan
        t["rag"] = np.where(t["target"] == 0, "No target", np.where(t["ach_pct"] >= (exp or 0), "Green",
                            np.where(t["ach_pct"] >= 0.8 * (exp or 0), "Amber", "Red"))) if exp else "n/a"
    r["insights"] = insights(r, start, end)
    r["checks"] = checks(r)
    return r


def _inr(x):
    x = float(x or 0)
    if abs(x) >= 1e7: return f"₹{x/1e7:.2f} Cr"
    if abs(x) >= 1e5: return f"₹{x/1e5:.2f} L"
    return f"₹{x:,.0f}"


def insights(r: dict, start: str, end: str) -> list:
    out = []
    k = r["kpi"]; total = float(k.get("sales") or 0)
    if not total:
        return ["No sales lines were returned for this date range."]
    out.append(f"{_inr(total)} sale from {int(k['orders']):,} orders ({int(k['lines']):,} lines) by {int(k['promoters']):,} promoters "
               f"at {int(k['outlets']):,} outlets; average order {_inr(total / max(k['orders'], 1))}, "
               f"{k['lines'] / max(k['orders'], 1):.1f} lines per order.")
    b = r["brand"]
    if len(b):
        top = b.iloc[0]; top3 = b.head(3)["share"].sum()
        out.append(f"{top['brand']} is {top['share']:.0%} of sale; top 3 brands = {top3:.0%}. "
                   f"Smallest brand: {b.iloc[-1]['brand']} ({b.iloc[-1]['share']:.1%}).")
    sku = r["sku"]
    if len(sku):
        n80 = int((sku["sales"].cumsum() / total < 0.8).sum()) + 1
        out.append(f"{n80} of {len(sku)} SKUs make 80% of sale. Best seller: {sku.iloc[0]['prd_name']} ({_inr(sku.iloc[0]['sales'])}).")
    d = r["daily"]
    if len(d) >= 2:
        best, worst = d.loc[d["sales"].idxmax()], d.loc[d["sales"].idxmin()]
        out.append(f"Best day {best['order_date']:%d-%b} ({_inr(best['sales'])}), weakest {worst['order_date']:%d-%b} ({_inr(worst['sales'])}).")
        if len(d) >= 14:
            last7, prev7 = d.tail(7)["sales"].sum(), d.iloc[-14:-7]["sales"].sum()
            if prev7:
                out.append(f"Last 7 days {_inr(last7)} vs previous 7 days {_inr(prev7)} ({(last7 / prev7 - 1):+.0%}).")
        wd = d.groupby("weekday")["sales"].mean()
        if len(wd) >= 5:
            out.append(f"Strongest weekday on average: {wd.idxmax()}; weakest: {wd.idxmin()}.")
    ka = r["kae"]
    if len(ka) >= 2:
        out.append(f"Top team: {ka.iloc[0]['kae']} ({_inr(ka.iloc[0]['sales'])}, {ka.iloc[0]['share']:.0%}). "
                   f"Lowest sale per promoter-day: {ka.loc[ka['sales_per_promoter_day'].idxmin(), 'kae']} "
                   f"({_inr(ka['sales_per_promoter_day'].min())}/day).")
    p = r["promoter"]
    if len(p):
        inact = p[p["days_since_last_sale"] >= 3]
        out.append(f"{len(inact)} promoters have not punched a sale in the last 3+ days of the range "
                   f"({(p['days_since_last_sale'] >= 7).sum()} for 7+ days).")
        top10 = p.head(max(1, len(p) // 10))["sales"].sum() / total
        out.append(f"Top 10% of promoters bring {top10:.0%} of sale. Median promoter sale {_inr(p['sales'].median())}.")
        multi = p[p["outlets"] > 1]
        if len(multi):
            out.append(f"{len(multi)} promoters punched sale at more than one outlet (check roster / floating staff).")
    a = r["account"]
    if len(a):
        out.append(f"Largest account: {a.iloc[0]['account']} ({a.iloc[0]['share']:.0%}).")
    rr = r["runrate"]
    if rr["projected"]:
        out.append(f"Straight-line projection for the month: {_inr(rr['projected'])} (day {rr['days_elapsed']} of {rr['days_in_month']}).")
    if "target_kae" in r:
        t = r["target_kae"]; tt, ta = t["target"].sum(), t["achievement"].sum()
        if tt:
            exp = rr["expected_pct"]
            out.append(f"Target {_inr(tt)}, achieved {_inr(ta)} ({ta / tt:.1%})" + (f" vs expected {exp:.1%}." if exp else "."))
        if "stores_no_sale" in r and len(r["stores_no_sale"]):
            out.append(f"{len(r['stores_no_sale'])} stores in the master have no sale in this range.")
    q = r["quality"]
    gap = r["order_gaps"]
    if len(gap):
        out.append(f"{len(gap)} orders' lines do not add up to the order total (difference {_inr(gap['gap'].abs().sum())}) – possible missing lines.")
    for name in ("Region does not match state", "Sold below MRP", "Possible duplicate line (same order, SKU, qty, amount)"):
        row = q[q["issue"] == name]
        if len(row):
            out.append(f"{name}: {int(row['lines'].iloc[0]):,} lines ({_inr(row['amount'].iloc[0])}).")
    return out


def checks(r: dict) -> list:
    tot = float(r["clean"]["total"].sum())
    res = [("Rows received from API (after page-overlap de-dup)", r["counts"]["raw"], len(r["clean"])),
           ("Rows after cleaning", r["counts"]["raw"], r["counts"]["clean"])]
    for key, label in (("kae", "KAE / team summary"), ("supervisor", "Supervisor summary"), ("promoter", "Promoter table"),
                       ("outlet", "Outlet table"), ("brand", "Brand table"), ("sku", "SKU table"), ("account", "Account table"),
                       ("daily", "Daily trend"), ("state", "State table"), ("channel", "Channel table")):
        res.append((f"{label} total = clean data total", round(tot, 2), round(float(r[key]["sales"].sum()), 2)))
    if "target_kae" in r:
        res.append(("Target table achievement = clean data total", round(tot, 2), round(float(r["target_kae"]["achievement"].sum()), 2)))
    return [dict(check=c, expected=e, actual=a, result="OK" if abs(float(e) - float(a)) < 0.5 else "CHECK") for c, e, a in res]


# ------------------------------------------------------------------ dashboard JSON
def _records(df, limit=None) -> list:
    if df is None or not len(df):
        return []
    d = df.head(limit) if limit else df
    d = d.replace([np.inf, -np.inf], np.nan)
    out = []
    for rec in d.to_dict(orient="records"):
        clean = {}
        for k, v in rec.items():
            if isinstance(v, (pd.Timestamp, dt.date, dt.datetime)): v = v.isoformat()[:10]
            elif isinstance(v, (np.bool_, bool)): v = bool(v)
            elif isinstance(v, (np.integer,)): v = int(v)
            elif isinstance(v, (np.floating, float)): v = None if math.isnan(v) else round(float(v), 4)
            elif v is pd.NaT: v = None
            clean[str(k)] = v
        out.append(clean)
    return out


def action_checks(a: dict, r: dict, prev: dict | None) -> list:
    tot = round(float(r["clean"]["total"].sum()), 2)
    res = [("Promoter list sale = clean data", tot, round(float(a["promoters"]["sale"].sum()), 2)),
           ("KAE scorecard sale = clean data", tot, round(float(a["kae_scorecard"]["sale"].sum()), 2)),
           ("Supervisor scorecard sale = clean data", tot, round(float(a["supervisor_scorecard"]["sale"].sum()), 2)),
           ("Outlet list sale = clean data", tot, round(float(a["outlets"]["sale"].sum()), 2)),
           ("Brand table sale = clean data", tot, round(float(a["brand"]["sale"].sum()), 2))]
    if prev is not None:
        pt = round(float(prev["clean"]["total"].sum()), 2)
        res += [("LMTD: KAE scorecard = LMTD clean data", pt, round(float(a["kae_scorecard"]["lmtd"].sum()), 2)),
                ("LMTD: promoter list = LMTD clean data", pt, round(float(a["promoters"]["lmtd"].sum()), 2)),
                ("LMTD: outlet list = LMTD clean data", pt, round(float(a["outlets"]["lmtd"].sum()), 2))]
    return [dict(check=c, expected=e, actual=v, result="OK" if abs(float(e) - float(v)) < 0.5 else "CHECK") for c, e, v in res]


def dashboard_json(r: dict, a: dict, meta: dict) -> dict:
    return dict(meta=meta, totals=a["totals"], has_prev=a["has_prev"], runrate=r["runrate"], actions=a["actions"], checks=r["checks"],
                kae=_records(a["kae_scorecard"]), supervisor=_records(a["supervisor_scorecard"]), promoters=_records(a["promoters"]),
                not_punched=_records(a["not_punched"]), no_sale=_records(a["no_sale"]), drops=_records(a["drops"]),
                never_punched=_records(a["never_punched"]), outlets=_records(a["outlets"]), outlet_drops=_records(a["outlet_drops"]),
                focus_skus=_records(a["focus_skus"]), sku_gaps=_records(a["sku_gaps"]), suspicious=_records(a["suspicious"]),
                brand=_records(a["brand"]), brand_index=_records(a["brand_index"]), daily=_records(a["daily"]),
                quality=_records(r["quality"]), order_gaps=_records(r["order_gaps"], 500),
                sku=_records(r["sku"]), account=_records(r["account"]))


# ------------------------------------------------------------------ Excel
NAVY, TEAL = "1F3864", "0F7B8A"
thin = Side(style="thin", color="C9D3E3"); BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = PatternFill("solid", fgColor=NAVY); TOT = PatternFill("solid", fgColor="DDEBF7")
def F(**k): return Font(**{"name": "Arial", "size": 10, **k})
FMT = {"sales": "#,##0", "amount": "#,##0", "target": "#,##0", "achievement": "#,##0", "aov": "#,##0", "mrp_value": "#,##0",
       "share": "0.0%", "ach_pct": "0.0%", "expected_pct": "0.0%", "lines_per_order": "0.0", "sales_per_promoter": "#,##0",
       "sales_per_promoter_day": "#,##0", "avg_active_days": "0.0", "avg_per_active_day": "#,##0", "gap_vs_plan": "#,##0",
       "required_per_day": "#,##0", "total": "#,##0", "mrp": "#,##0", "price_diff": "#,##0", "cum_sales": "#,##0",
       "gap": "#,##0", "lines_sum": "#,##0", "order_total": "#,##0", "order_total_api": "#,##0", "order_gap": "#,##0"}
LABEL = {"kae": "KAE / Team", "supervisor": "Supervisor", "channel": "Channel", "sales": "Sale (₹)", "qty": "Qty", "orders": "Orders",
         "lines": "Lines", "promoters": "Promoters", "outlets": "Outlets", "days_with_sale": "Days with sale", "promoter_days": "Promoter-days",
         "share": "Share %", "aov": "Avg order ₹", "lines_per_order": "Lines / order", "sales_per_promoter": "₹ / promoter",
         "avg_active_days": "Avg active days", "sales_per_promoter_day": "₹ / promoter-day", "rank": "Rank"}


def _write_table(ws, df: pd.DataFrame, r0: int, c0: int = 1, total_row=True, sum_cols=None, title=None):
    if title:
        ws.cell(r0, c0, title).font = F(bold=True, size=12, color=TEAL); r0 += 1
    cols = list(df.columns)
    for j, c in enumerate(cols):
        cell = ws.cell(r0, c0 + j, LABEL.get(c, str(c).replace("_", " ").title()))
        cell.font = F(bold=True, color="FFFFFF"); cell.fill = HF; cell.border = BOX
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[r0].height = 30
    vals = df.replace([np.inf, -np.inf], np.nan)
    for i, rec in enumerate(vals.itertuples(index=False), r0 + 1):
        for j, v in enumerate(rec):
            if isinstance(v, float) and math.isnan(v): v = None
            elif isinstance(v, pd.Timestamp): v = v.to_pydatetime()
            elif isinstance(v, np.generic): v = v.item()
            cell = ws.cell(i, c0 + j, v); cell.font = F(); cell.border = BOX
            f = FMT.get(cols[j])
            if f: cell.number_format = f
            elif isinstance(v, (dt.date, dt.datetime)): cell.number_format = "dd-mmm-yy"
    last = r0 + len(df)
    if total_row and len(df):
        t = last + 1
        ws.cell(t, c0, "Total").font = F(bold=True)
        for j, c in enumerate(cols):
            if sum_cols and c in sum_cols:
                cell = ws.cell(t, c0 + j, f"=SUBTOTAL(9,{L(c0+j)}{r0+1}:{L(c0+j)}{last})"); cell.number_format = FMT.get(c, "#,##0")
            for cc in (ws.cell(t, c0 + j),):
                cc.font = F(bold=True); cc.fill = TOT; cc.border = BOX
        last = t
    for j, c in enumerate(cols):
        w = max(len(str(LABEL.get(c, c))), *(len(str(x)) for x in df[c].head(200).tolist())) if len(df) else len(str(c))
        ws.column_dimensions[L(c0 + j)].width = min(max(9, w + 2), 48)
    return r0, last


SUMS = {"sales", "qty", "orders", "lines", "promoter_days", "target", "achievement", "amount", "gap_vs_plan"}



FMT.update({"sale": "#,##0", "lmtd": "#,##0", "change": "#,##0;[Red]-#,##0", "growth": "0.0%;[Red]-0.0%", "rs_per_active_day": "#,##0",
            "rs_per_promoter_day": "#,##0", "punch_discipline": "0%", "punch_pct": "0%", "opportunity": "#,##0", "gap_opportunity": "#,##0",
            "median_sale_per_outlet": "#,##0", "penetration": "0%", "sale_last_day": "#,##0", "last7": "#,##0", "prev7": "#,##0",
            "change7": "#,##0;[Red]-#,##0", "cum_sale": "#,##0", "cum_lmtd": "#,##0"})
NICE = {"emp_code": "Emp code", "emp_name": "Promoter", "kae": "KAE", "supervisor": "Supervisor", "channel": "Channel", "main_outlet": "Main outlet",
        "outlet_code": "Outlet code", "sale": "Sale ₹", "lmtd": "LMTD ₹", "change": "Change ₹", "growth": "Growth %", "active_days": "Active days",
        "last_sale": "Last sale", "days_since_last_sale": "Days since sale", "sale_last_day": "Sale on last day", "punch_pct": "Punch %",
        "rs_per_active_day": "₹ / active day", "status": "Status", "cust_code": "Outlet code", "cust_name": "Outlet", "account": "Account",
        "promoter": "Promoter", "missing_count": "Focus SKUs missing", "focus_skus": "Focus SKUs", "opportunity": "Opportunity ₹",
        "missing_skus": "Missing SKUs", "prd_name": "SKU", "brand": "Brand", "outlets_selling": "Outlets selling", "outlets_missing": "Outlets missing",
        "penetration": "Penetration", "median_sale_per_outlet": "Median ₹ / outlet", "type": "Check", "detail": "Detail", "amount": "Amount ₹",
        "punched_last_day": "Punched last day", "not_punched": "Not punched", "dropping_promoters": "Dropping promoters", "suspicious": "To verify",
        "sku_gaps": "SKU gaps", "gap_opportunity": "Gap opportunity ₹", "punch_discipline": "Punch discipline", "rs_per_promoter_day": "₹ / promoter-day",
        "share": "Share", "rag": "RAG", "rag_basis": "RAG basis", "rank": "Rank", "promoters": "Promoters", "outlets": "Outlets",
        "promoter_days": "Promoter-days", "target": "Target ₹", "ach_pct": "Ach %", "date": "Date", "order_ref": "Order", "basis": "Basis"}
LABEL.update(NICE)


def _rag_fmt(ws, col_letter, first, last):
    for v, c in (("Green", "C6EFCE"), ("Amber", "FFE699"), ("Red", "F8CBAD")):
        ws.conditional_formatting.add(f"{col_letter}{first}:{col_letter}{last}", CellIsRule(operator="equal", formula=[f'"{v}"'], fill=PatternFill("solid", fgColor=c)))


def write_excel(r: dict, a: dict, meta: dict, path):
    wb = Workbook()
    t = a["totals"]
    ws = wb.active; ws.title = "Action Center"; ws.sheet_view.showGridLines = False
    ws["A1"] = "Sales Action Center"; ws["A1"].font = F(bold=True, size=18, color=NAVY)
    sub = f"{meta['start']} to {meta['end']} (data till {t['last_day']})"
    if meta.get("lmtd_start"): sub += f"   |   LMTD {meta['lmtd_start']} to {meta['lmtd_end']}"
    ws["A2"] = sub + f"   |   generated {meta['generated']}"; ws["A2"].font = F(size=10, color="595959")
    g = (t["sale"] / t["lmtd"] - 1) if t.get("lmtd") else None
    tiles = [("SALE ₹", t["sale"], "#,##0"), ("LMTD ₹", t["lmtd"] or 0, "#,##0"), ("GROWTH", g if g is not None else 0, "0.0%;[Red]-0.0%"),
             ("PROMOTERS ACTIVE", t["promoters"], "#,##0"), (f"PUNCHED {dt.date.fromisoformat(t['last_day']):%d-%b}", t["punched_last_day"], "#,##0"),
             ("NOT PUNCHED", len(a["not_punched"]), "#,##0"), (f"NO SALE 3+ DAYS", len(a["no_sale"]), "#,##0"),
             ("SKU GAP ₹", float(a["sku_gaps"]["opportunity"].sum()) if len(a["sku_gaps"]) else 0, "#,##0"),
             ("ENTRIES TO VERIFY", len(a["suspicious"]), "#,##0"), ("OUTLETS BILLED", t["outlets"], "#,##0")]
    for n, (lab, v, fmt) in enumerate(tiles):
        c0 = 1 + (n % 5) * 3; r0 = 4 + (n // 5) * 4
        ws.merge_cells(start_row=r0, start_column=c0, end_row=r0, end_column=c0 + 1)
        ws.merge_cells(start_row=r0 + 1, start_column=c0, end_row=r0 + 2, end_column=c0 + 1)
        x = ws.cell(r0, c0, lab); x.font = F(bold=True, size=9, color="FFFFFF"); x.fill = PatternFill("solid", fgColor=TEAL if n < 3 else NAVY)
        x.alignment = Alignment(horizontal="center")
        y = ws.cell(r0 + 1, c0, float(v or 0)); y.number_format = fmt; y.font = F(bold=True, size=18, color=NAVY)
        y.alignment = Alignment(horizontal="center", vertical="center")
        for rr in range(r0, r0 + 3):
            for cc in range(c0, c0 + 2): ws.cell(rr, cc).border = BOX
    row = 13
    ws.cell(row, 1, "What to do today").font = F(bold=True, size=13, color=TEAL)
    colors = {"red": "F8CBAD", "amber": "FFE699", "green": "C6EFCE"}
    for i, act in enumerate(a["actions"], row + 1):
        c = ws.cell(i, 1, act["area"]); c.font = F(bold=True); c.fill = PatternFill("solid", fgColor=colors.get(act["level"], "DDEBF7")); c.border = BOX
        c.alignment = Alignment(vertical="top", wrap_text=True)
        ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=2)
        d = ws.cell(i, 3, act["text"]); d.font = F(); d.alignment = Alignment(wrap_text=True, vertical="top"); d.border = BOX
        ws.merge_cells(start_row=i, start_column=3, end_row=i, end_column=15); ws.row_dimensions[i].height = 44
    for c in range(1, 16): ws.column_dimensions[L(c)].width = 11

    def sheet(name, df, cols, sums=("sale", "lmtd", "change", "opportunity", "amount", "gap_opportunity", "target"), rag=False, note=None):
        s = wb.create_sheet(name); s.sheet_view.showGridLines = False
        r0 = 1
        if note:
            s.cell(1, 1, note).font = F(italic=True, color="595959"); r0 = 3
        if df is None or not len(df):
            s.cell(r0, 1, "Nothing to show – good."); return s
        cols = [c for c in cols if c in df.columns]
        h, last = _write_table(s, df[cols], r0, sum_cols=[c for c in cols if c in sums])
        s.freeze_panes = s.cell(h + 1, 3); s.auto_filter.ref = f"A{h}:{L(len(cols))}{h + len(df)}"
        if rag and "rag" in cols:
            _rag_fmt(s, L(cols.index("rag") + 1), h + 1, h + len(df))
        if "growth" in cols:
            gl = L(cols.index("growth") + 1)
            s.conditional_formatting.add(f"{gl}{h+1}:{gl}{h+len(df)}", CellIsRule(operator="lessThan", formula=["0"], font=Font(color="C00000", bold=True)))
        return s

    sc_cols = ["rank", "kae", "channel", "rag", "sale", "lmtd", "change", "growth", "target", "ach_pct", "share", "promoters", "punched_last_day",
               "not_punched", f"no_sale_{actions_mod.NO_SALE_DAYS}d", "dropping_promoters", "punch_discipline", "rs_per_promoter_day", "outlets", "sku_gaps",
               "gap_opportunity", "suspicious", "rag_basis"]
    sheet("KAE Scorecard", a["kae_scorecard"], sc_cols, rag=True)
    sheet("Supervisor Scorecard", a["supervisor_scorecard"], ["rank", "supervisor", "kae"] + sc_cols[2:], rag=True)
    pcols = ["emp_code", "emp_name", "kae", "supervisor", "channel", "main_outlet", "outlet_code", "status", "sale", "lmtd", "change", "growth",
             "sale_last_day", "active_days", "punch_pct", "last_sale", "days_since_last_sale", "rs_per_active_day", "outlets"]
    sheet("Not Punched", a["not_punched"], pcols, note=f"Promoters with sale in the period but nothing on {t['last_day']} – call their supervisor.")
    sheet("No Sale 3+ Days", a["no_sale"], pcols, note="No sale for 3 or more days – check attendance, stock or replacement.")
    if len(a["never_punched"]):
        sheet("Never Punched", a["never_punched"], ["emp_code", "emp_name", "kae", "supervisor", "cust_code", "account", "status"],
              note="Active promoters in the roster with no sale punched in this period.")
    sheet("Promoter Decline", a["drops"], pcols + ["last7", "prev7", "change7", "basis"], note="Promoters down 20%+ (vs LMTD, or last 7 vs previous 7 days). Worst first.")
    sheet("Outlet Decline", a["outlet_drops"], ["cust_code", "cust_name", "account", "kae", "supervisor", "promoter", "sale", "lmtd", "change", "growth", "days_since_last_sale"],
          note="Outlets down 20%+ vs LMTD (incl. outlets with no sale this period). Worst first.")
    sheet("Outlet SKU Gaps", a["sku_gaps"], ["cust_code", "cust_name", "account", "kae", "supervisor", "promoter", "channel", "missing_count", "focus_skus",
                                             "opportunity", "missing_skus", "sale"],
          note="Focus SKUs = sold in 40%+ of outlets of the same channel. Opportunity = what a typical outlet sells of each missing SKU.")
    sheet("Focus SKUs", a["focus_skus"], ["channel", "prd_name", "brand", "outlets_selling", "outlets_missing", "penetration", "median_sale_per_outlet", "opportunity"])
    sheet("Entries To Verify", a["suspicious"], ["type", "date", "emp_code", "emp_name", "kae", "supervisor", "cust_name", "detail", "amount", "order_ref"],
          note="Quantity spikes, same SKU twice in one order, one promoter at several outlets on one day, below-MRP sale.")
    sheet("All Promoters", a["promoters"], pcols)
    sheet("All Outlets", a["outlets"], ["cust_code", "cust_name", "account", "channel", "kae", "supervisor", "promoter", "sale", "lmtd", "change", "growth",
                                        "orders", "skus", "days_with_sale", "last_sale", "days_since_last_sale"])
    sheet("Brand", a["brand"], ["brand", "sale", "lmtd", "change", "growth", "share"])
    bi = wb.create_sheet("Brand Mix Index"); bi.sheet_view.showGridLines = False
    bi["A1"] = "Brand share in each KAE ÷ company brand share (1.00 = same as company, below 0.60 = under-selling)"; bi["A1"].font = F(italic=True, color="595959")
    if len(a["brand_index"]):
        h, last = _write_table(bi, a["brand_index"], 3, total_row=False)
        rng = f"B{h+1}:{L(len(a['brand_index'].columns))}{last}"
        bi.conditional_formatting.add(rng, ColorScaleRule(start_type="num", start_value=0.3, start_color="F8696B", mid_type="num", mid_value=1, mid_color="FFFFFF", end_type="num", end_value=1.7, end_color="63BE7B"))
    dsh = sheet("Daily Trend", a["daily"], ["date", "sale", "lmtd", "cum_sale", "cum_lmtd", "promoters", "outlets"])
    if len(a["daily"]) > 1:
        ch = LineChart(); ch.title = "Cumulative sale vs LMTD" if a["has_prev"] else "Daily sale"; ch.height = 8; ch.width = 22
        cols = ["date", "sale", "lmtd", "cum_sale", "cum_lmtd", "promoters", "outlets"]; cols = [c for c in cols if c in a["daily"].columns]
        series = ["cum_sale", "cum_lmtd"] if a["has_prev"] else ["sale"]
        for sname in series:
            ci = cols.index(sname) + 1
            ch.add_data(Reference(dsh, min_col=ci, min_row=1, max_row=len(a["daily"]) + 1), titles_from_data=True)
        ch.set_categories(Reference(dsh, min_col=1, min_row=2, max_row=len(a["daily"]) + 1)); ch.y_axis.number_format = "#,##0"
        dsh.add_chart(ch, "J2")
    sheet("Data Quality", r["quality"], ["issue", "lines", "orders", "amount"], sums=())
    sheet("Order Gaps", r["order_gaps"], list(r["order_gaps"].columns) if len(r["order_gaps"]) else [], sums=("gap",))
    s_clean = sheet("Clean Data", r["clean"], list(r["clean"].columns), sums=("total", "qty"))

    # Control checks with live formulas back to Clean Data
    s = wb.create_sheet("Control Checks", 1); s.sheet_view.showGridLines = False
    s["A1"] = "Control Checks – every total ties back to Clean Data"; s["A1"].font = F(bold=True, size=14, color=NAVY)
    for j, h in enumerate(["Check", "Expected", "Actual", "Difference", "Result"], 1):
        c = s.cell(3, j, h); c.font = F(bold=True, color="FFFFFF"); c.fill = HF; c.border = BOX
    n = len(r["clean"]); tcol = L(list(r["clean"].columns).index("total") + 1)
    ct = f"SUM('Clean Data'!{tcol}2:{tcol}{n + 1})"
    lines = [("Rows from API = rows in Clean Data", r["counts"]["raw"], f"=COUNTA('Clean Data'!B2:B{n + 1})")]
    for name, df in (("KAE Scorecard", a["kae_scorecard"]), ("Supervisor Scorecard", a["supervisor_scorecard"]), ("All Promoters", a["promoters"]),
                     ("All Outlets", a["outlets"]), ("Brand", a["brand"])):
        cols_ = {"KAE Scorecard": [c for c in sc_cols if c in df.columns], "Supervisor Scorecard": [c for c in ["rank", "supervisor", "kae"] + sc_cols[2:] if c in df.columns],
                 "All Promoters": [c for c in pcols if c in df.columns],
                 "All Outlets": [c for c in ["cust_code", "cust_name", "account", "channel", "kae", "supervisor", "promoter", "sale"] if c in df.columns],
                 "Brand": ["brand", "sale"]}[name]
        col = L(cols_.index("sale") + 1)
        lines.append((f"{name} sale = Clean Data sale", f"={ct}", f"=SUM('{name}'!{col}2:{col}{len(df) + 1})"))
    for i, (c, e, v) in enumerate(lines, 4):
        s.cell(i, 1, c).font = F(bold=True); s.cell(i, 2, e); s.cell(i, 3, v); s.cell(i, 4, f"=C{i}-B{i}")
        s.cell(i, 5, f'=IF(ABS(D{i})<0.5,"OK","CHECK")')
        for j in range(1, 6):
            s.cell(i, j).border = BOX
            if j in (2, 3, 4): s.cell(i, j).number_format = "#,##0"; s.cell(i, j).font = F()
    last = 3 + len(lines)
    off = last + 1
    for i, chk in enumerate([c for c in r["checks"] if c["check"].startswith("LMTD")], off):
        s.cell(i, 1, chk["check"]).font = F(bold=True); s.cell(i, 2, chk["expected"]); s.cell(i, 3, chk["actual"])
        s.cell(i, 4, f"=C{i}-B{i}"); s.cell(i, 5, f'=IF(ABS(D{i})<0.5,"OK","CHECK")')
        for j in range(1, 6):
            s.cell(i, j).border = BOX
            if j in (2, 3, 4): s.cell(i, j).number_format = "#,##0"
        last = i
    s.conditional_formatting.add(f"E4:E{last}", CellIsRule(operator="equal", formula=['"OK"'], fill=PatternFill("solid", fgColor="C6EFCE"), font=Font(bold=True, color="006100")))
    s.conditional_formatting.add(f"E4:E{last}", CellIsRule(operator="equal", formula=['"CHECK"'], fill=PatternFill("solid", fgColor="FFC7CE"), font=Font(bold=True, color="9C0006")))
    s.cell(last + 2, 1, "All checks").font = F(bold=True, size=12)
    s.cell(last + 2, 2, f'=IF(COUNTIF(E4:E{last},"OK")={last - 3},"ALL OK","REVIEW")').font = F(bold=True, size=12)
    s.cell(last + 4, 1, "Fetch details").font = F(bold=True, size=12, color=TEAL)
    for i, (kk, vv) in enumerate(meta.get("fetch", {}).items(), last + 5):
        s.cell(i, 1, kk).font = F(); s.cell(i, 2, str(vv)).font = F()
    s.column_dimensions["A"].width = 46
    for c in "BCDE": s.column_dimensions[c].width = 16
    for sh in wb.worksheets:
        sh.sheet_properties.tabColor = {"Action Center": TEAL, "Control Checks": "00B050"}.get(sh.title, "C00000" if sh.title in (
            "Not Punched", "No Sale 3+ Days", "Never Punched", "Promoter Decline", "Outlet Decline", "Entries To Verify") else NAVY)
    wb.save(path)
