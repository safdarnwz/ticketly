"""Turn the cleaned aggregates into (1) dashboard JSON for the web page and (2) a styled Excel workbook.
The page and the workbook are built from the same numbers, so they always match."""
from __future__ import annotations

import calendar
import datetime as dt
import math

import numpy as np
import pandas as pd
from openpyxl import Workbook
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
def _records(df: pd.DataFrame, limit=None) -> list:
    if df is None or not len(df):
        return []
    d = df.head(limit) if limit else df
    d = d.replace([np.inf, -np.inf], np.nan)
    out = []
    for rec in d.to_dict(orient="records"):
        clean = {}
        for k, v in rec.items():
            if isinstance(v, (pd.Timestamp, dt.date, dt.datetime)): v = v.isoformat()[:10]
            elif isinstance(v, (np.integer,)): v = int(v)
            elif isinstance(v, (np.floating, float)): v = None if math.isnan(v) else round(float(v), 4)
            elif v is pd.NaT: v = None
            clean[str(k)] = v
        out.append(clean)
    return out


def dashboard_json(r: dict, meta: dict) -> dict:
    k = {kk: (v.isoformat() if hasattr(v, "isoformat") else (float(v) if isinstance(v, (np.floating, np.integer)) else v)) for kk, v in r["kpi"].items()}
    return dict(meta=meta, kpi=k, runrate=r["runrate"], insights=r["insights"], checks=r["checks"],
                daily=_records(r["daily"]), brand=_records(r["brand"]), account=_records(r["account"]), channel=_records(r["channel"]),
                kae=_records(r["kae"]), supervisor=_records(r["supervisor"]), promoter=_records(r["promoter"]),
                outlet=_records(r["outlet"]), sku=_records(r["sku"]), state=_records(r["state"]), quality=_records(r["quality"]),
                order_gaps=_records(r["order_gaps"], 500), target_kae=_records(r.get("target_kae")),
                stores_no_sale=_records(r.get("stores_no_sale"), 500))


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


def write_excel(r: dict, meta: dict, path):
    wb = Workbook()
    ws = wb.active; ws.title = "Dashboard"; ws.sheet_view.showGridLines = False
    ws["A1"] = "SalesDiary – Tertiary Sales Dashboard"; ws["A1"].font = F(bold=True, size=18, color=NAVY)
    ws["A2"] = f"Period {meta['start']} to {meta['end']}   |   generated {meta['generated']}   |   source rows {meta['rows']:,}"
    ws["A2"].font = F(size=10, color="595959")
    k = r["kpi"]
    tiles = [("SALE (₹)", k["sales"], "#,##0"), ("ORDERS", k["orders"], "#,##0"), ("LINES", k["lines"], "#,##0"), ("QTY", k["qty"], "#,##0"),
             ("PROMOTERS", k["promoters"], "#,##0"), ("OUTLETS", k["outlets"], "#,##0"), ("SKUs", k["skus"], "#,##0"),
             ("AVG ORDER (₹)", (k["sales"] or 0) / max(k["orders"] or 1, 1), "#,##0")]
    if r["runrate"]["projected"]:
        tiles.append(("PROJECTED MONTH (₹)", r["runrate"]["projected"], "#,##0"))
    for n, (lab, v, fmt) in enumerate(tiles):
        c0 = 1 + (n % 5) * 3; r0 = 4 + (n // 5) * 4
        ws.merge_cells(start_row=r0, start_column=c0, end_row=r0, end_column=c0 + 1)
        ws.merge_cells(start_row=r0 + 1, start_column=c0, end_row=r0 + 2, end_column=c0 + 1)
        a = ws.cell(r0, c0, lab); a.font = F(bold=True, size=9, color="FFFFFF"); a.fill = PatternFill("solid", fgColor=TEAL if n == 0 else NAVY)
        a.alignment = Alignment(horizontal="center")
        b = ws.cell(r0 + 1, c0, float(v or 0)); b.number_format = fmt; b.font = F(bold=True, size=18, color=NAVY)
        b.alignment = Alignment(horizontal="center", vertical="center")
        for rr in range(r0, r0 + 3):
            for cc in range(c0, c0 + 2): ws.cell(rr, cc).border = BOX
    row = 13
    ws.cell(row, 1, "Insights").font = F(bold=True, size=13, color=TEAL)
    for i, t in enumerate(r["insights"], row + 1):
        ws.cell(i, 1, f"• {t}").font = F(); ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=15)
        ws.cell(i, 1).alignment = Alignment(wrap_text=True, vertical="top"); ws.row_dimensions[i].height = 28
    for c in range(1, 16): ws.column_dimensions[L(c)].width = 11

    def sheet(name, df, sums=SUMS, cf_share=True, freeze="B2"):
        s = wb.create_sheet(name); s.sheet_view.showGridLines = False
        if df is None or not len(df):
            s["A1"] = "No data"; return s, None
        r0, last = _write_table(s, df, 1, sum_cols=[c for c in df.columns if c in sums])
        s.freeze_panes = freeze; s.auto_filter.ref = f"A1:{L(len(df.columns))}{r0 + len(df)}"
        cols = list(df.columns)
        if "sales" in cols:
            col = L(cols.index("sales") + 1)
            s.conditional_formatting.add(f"{col}2:{col}{len(df)+1}", DataBarRule(start_type="num", start_value=0, end_type="max", color="5B9BD5"))
        return s, (r0, last)

    kae_cols = ["rank", "kae", "channel", "sales", "share", "orders", "lines", "qty", "promoters", "outlets", "promoter_days",
                "avg_active_days", "sales_per_promoter", "sales_per_promoter_day", "aov", "lines_per_order"]
    s_kae, _ = sheet("KAE Summary", r["kae"][kae_cols] if len(r["kae"]) else r["kae"])
    s_sup, _ = sheet("Supervisor Summary", r["supervisor"][["rank", "supervisor"] + kae_cols[1:]] if len(r["supervisor"]) else r["supervisor"])
    if "target_kae" in r:
        sheet("Target vs Achievement", r["target_kae"])
        sheet("Stores without sale", r.get("stores_no_sale"))
    pcols = ["emp_code", "emp_name", "supervisor", "kae", "channel", "role", "status", "sales", "orders", "lines", "qty", "active_days",
             "avg_per_active_day", "outlets", "outlet_codes", "first_sale", "last_sale", "days_since_last_sale", "name_variants"]
    s_p, _ = sheet("Promoters", r["promoter"][[c for c in pcols if c in r["promoter"].columns]])
    ocols = ["cust_code", "cust_name", "account", "account_source", "channel", "state", "district", "kae", "status", "sales", "orders",
             "qty", "skus", "promoters", "days_with_sale", "last_sale", "days_since_last_sale"]
    sheet("Outlets", r["outlet"][[c for c in ocols if c in r["outlet"].columns]])
    sheet("Brands", r["brand"][["brand", "sales", "share", "orders", "lines", "qty", "promoters", "outlets", "aov"]] if len(r["brand"]) else r["brand"])
    sheet("SKUs", r["sku"][["prd_code", "prd_name", "brand", "categ", "mrp", "sales", "share", "qty", "orders", "outlets", "promoters"]] if len(r["sku"]) else r["sku"])
    s_d, pos = sheet("Daily Trend", r["daily"][["order_date", "weekday", "sales", "cum_sales", "orders", "lines", "qty", "promoters", "outlets"]] if len(r["daily"]) else r["daily"])
    if pos and len(r["daily"]) > 1:
        ch = LineChart(); ch.title = "Daily sale"; ch.height = 8; ch.width = 22; ch.y_axis.number_format = "#,##0"
        ch.add_data(Reference(s_d, min_col=3, min_row=1, max_row=len(r["daily"]) + 1), titles_from_data=True)
        ch.set_categories(Reference(s_d, min_col=1, min_row=2, max_row=len(r["daily"]) + 1)); ch.legend = None
        s_d.add_chart(ch, "L2")
    sheet("Daily x Brand", r["daily_brand"], sums=set(r["daily_brand"].columns) - {"order_date"})
    sheet("Account Summary", r["account"][["account", "channel", "sales", "share", "orders", "lines", "qty", "promoters", "outlets", "aov"]] if len(r["account"]) else r["account"])
    sheet("Account x Brand", r["account_brand"], sums=set(r["account_brand"].columns) - {"account"})
    sheet("State Summary", r["state"])
    sheet("Data Quality", r["quality"], sums={"lines", "amount"})
    sheet("Order Gaps", r["order_gaps"], sums={"gap"})
    s_c, cpos = sheet("Clean Data", r["clean"], sums={"total", "qty", "mrp_value"}, freeze="C2")

    # Control checks: formulas compare every sheet total with the Clean Data total
    s = wb.create_sheet("Control Checks", 1); s.sheet_view.showGridLines = False
    s["A1"] = "Control Checks – every total must tie back to Clean Data"; s["A1"].font = F(bold=True, size=14, color=NAVY)
    hdr = ["Check", "Expected", "Actual", "Difference", "Result"]
    for j, h in enumerate(hdr, 1):
        c = s.cell(3, j, h); c.font = F(bold=True, color="FFFFFF"); c.fill = HF; c.border = BOX
    n_clean = len(r["clean"]); tcol = L(list(r["clean"].columns).index("total") + 1)
    clean_total = f"SUM('Clean Data'!{tcol}2:{tcol}{n_clean + 1})"
    lines = [("Rows from API = rows in Clean Data", r["counts"]["raw"], f"=COUNTA('Clean Data'!B2:B{n_clean + 1})")]
    for name, df in (("KAE Summary", r["kae"]), ("Supervisor Summary", r["supervisor"]), ("Promoters", r["promoter"]), ("Outlets", r["outlet"]),
                     ("Brands", r["brand"]), ("SKUs", r["sku"]), ("Daily Trend", r["daily"]), ("Account Summary", r["account"])):
        if not len(df): continue
        cols = {"KAE Summary": kae_cols, "Supervisor Summary": ["rank", "supervisor"] + kae_cols[1:], "Promoters": [c for c in pcols if c in df.columns],
                "Outlets": [c for c in ocols if c in df.columns], "Brands": ["brand", "sales"], "SKUs": ["prd_code", "prd_name", "brand", "categ", "mrp", "sales"],
                "Daily Trend": ["order_date", "weekday", "sales"], "Account Summary": ["account", "channel", "sales"]}[name]
        col = L(cols.index("sales") + 1)
        lines.append((f"{name} sale = Clean Data sale", f"={clean_total}", f"=SUM('{name}'!{col}2:{col}{len(df) + 1})"))
    if "target_kae" in r:
        tk = r["target_kae"]; col = L(list(tk.columns).index("achievement") + 1)
        lines.append(("Target vs Achievement = Clean Data sale", f"={clean_total}", f"=SUM('Target vs Achievement'!{col}2:{col}{len(tk) + 1})"))
    for i, (c, e, a) in enumerate(lines, 4):
        s.cell(i, 1, c).font = F(bold=True); s.cell(i, 2, e); s.cell(i, 3, a); s.cell(i, 4, f"=C{i}-B{i}")
        s.cell(i, 5, f'=IF(ABS(D{i})<0.5,"OK","CHECK")')
        for j in range(1, 6):
            s.cell(i, j).border = BOX
            if j in (2, 3, 4): s.cell(i, j).number_format = "#,##0"; s.cell(i, j).font = F()
    last = 3 + len(lines)
    s.conditional_formatting.add(f"E4:E{last}", CellIsRule(operator="equal", formula=['"OK"'], fill=PatternFill("solid", fgColor="C6EFCE"), font=Font(bold=True, color="006100")))
    s.conditional_formatting.add(f"E4:E{last}", CellIsRule(operator="equal", formula=['"CHECK"'], fill=PatternFill("solid", fgColor="FFC7CE"), font=Font(bold=True, color="9C0006")))
    s.cell(last + 2, 1, "All checks").font = F(bold=True, size=12)
    s.cell(last + 2, 2, f'=IF(COUNTIF(E4:E{last},"OK")={len(lines)},"ALL OK","REVIEW")').font = F(bold=True, size=12)
    s.cell(last + 4, 1, "Fetch details").font = F(bold=True, size=12, color=TEAL)
    for i, (kk, vv) in enumerate(meta.get("fetch", {}).items(), last + 5):
        s.cell(i, 1, kk).font = F(); s.cell(i, 2, str(vv)).font = F()
    s.column_dimensions["A"].width = 46
    for c in "BCDE": s.column_dimensions[c].width = 16

    for sh in wb.worksheets:
        sh.sheet_properties.tabColor = {"Dashboard": TEAL, "Control Checks": "00B050", "Data Quality": "C00000", "Order Gaps": "C00000"}.get(sh.title, NAVY)
    wb.save(path)
