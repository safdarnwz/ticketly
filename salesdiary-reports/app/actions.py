"""Action-oriented analysis for an MT / SAMT sales manager.

Everything here answers "who / where / how much / what to do", not "what share is brand X":
  * promoters who did not punch on the last day, have had no sale for N days, or never punched (roster)
  * sale vs LMTD (same days last month) by KAE, supervisor, promoter, outlet and brand, incl. promoters/outlets that stopped
  * focus-SKU gaps per outlet with the rupee opportunity (what similar outlets sell of that SKU)
  * suspicious entries: quantity spikes, duplicate lines, below-MRP lines, one promoter at several outlets on one day
  * KAE and supervisor scorecards with RAG, and specific, ranked action bullets.
Input is the cleaned line-level DataFrame from spark_clean (current period, optional previous period).
"""
from __future__ import annotations

import calendar
import datetime as dt
import math
import os

import numpy as np
import pandas as pd

NO_SALE_DAYS = int(os.getenv("NO_SALE_DAYS", "3"))
DROP_PCT = float(os.getenv("DROP_PCT", "20")) / 100
DROP_MIN_RS = float(os.getenv("DROP_MIN_RS", "5000"))
FOCUS_PENETRATION = float(os.getenv("FOCUS_PENETRATION", "0.4"))
QTY_SPIKE_MIN = int(os.getenv("QTY_SPIKE_MIN", "10"))
QTY_SPIKE_X = float(os.getenv("QTY_SPIKE_X", "5"))
NOCODE = "(no salesman code)"


def shift_month(d: dt.date, months: int = -1) -> dt.date:
    y, m = d.year, d.month + months
    while m < 1: y, m = y - 1, m + 12
    while m > 12: y, m = y + 1, m - 12
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def previous_period(start: str, end: str) -> tuple[str, str]:
    """Same days last month (LMTD). 01-Nov..18-Nov -> 01-Oct..18-Oct; 25-Oct..05-Nov -> 25-Sep..05-Oct."""
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    return shift_month(s).isoformat(), shift_month(e).isoformat()


def _inr(x) -> str:
    x = float(x or 0); sign = "-" if x < 0 else ""; x = abs(x)
    if x >= 1e7: return f"{sign}₹{x/1e7:.2f} Cr"
    if x >= 1e5: return f"{sign}₹{x/1e5:.2f} L"
    if x >= 1e3: return f"{sign}₹{x/1e3:.1f}k"
    return f"{sign}₹{x:,.0f}"


def _pct(a, b):
    return np.nan if not b else a / b - 1


def _growth(cur: pd.Series, prev: pd.Series) -> pd.Series:
    return np.where(prev > 0, cur / prev.replace(0, np.nan) - 1, np.where(cur > 0, np.nan, np.nan))


def _mode(s: pd.Series):
    s = s.dropna()
    return s.mode().iloc[0] if len(s) else None


def _prep(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    d["order_date"] = pd.to_datetime(d["order_date"])
    d["emp_code"] = d["emp_code"].fillna(NOCODE)
    d["emp_name"] = d["emp_name"].fillna("")
    for c in ("kae", "supervisor", "channel", "cust_code", "brand", "prd_name"):
        d[c] = d[c].fillna("(blank)")
    return d


def build(cur_df: pd.DataFrame, prev_df: pd.DataFrame | None, start: str, end: str,
          master_pos: pd.DataFrame | None = None, target_kae: pd.DataFrame | None = None) -> dict:
    cur = _prep(cur_df)
    prev = _prep(prev_df) if prev_df is not None and len(prev_df) else None
    has_prev = prev is not None
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    last_day = cur["order_date"].max().date() if len(cur) else e
    data_days = int(cur["order_date"].dt.normalize().nunique())
    seven = (last_day - s).days + 1 >= 14

    # ------------------------------------------------------------- promoters
    g = cur.groupby("emp_code", dropna=False)
    prom = pd.DataFrame({
        "emp_name": g["emp_name"].agg(_mode), "kae": g["kae"].agg(_mode), "supervisor": g["supervisor"].agg(_mode),
        "channel": g["channel"].agg(_mode), "main_outlet": g["cust_name"].agg(_mode), "outlet_code": g["cust_code"].agg(_mode),
        "outlets": g["cust_code"].nunique(), "sale": g["total"].sum(), "orders": g["order_ref"].nunique(), "qty": g["qty"].sum(),
        "active_days": g["order_date"].nunique(), "first_sale": g["order_date"].min(), "last_sale": g["order_date"].max(),
    }).reset_index()
    ld = cur[cur["order_date"].dt.date == last_day].groupby("emp_code")["total"].sum()
    prom["sale_last_day"] = prom["emp_code"].map(ld).fillna(0)
    prom["days_since_last_sale"] = (pd.Timestamp(last_day) - prom["last_sale"]).dt.days
    prom["punch_pct"] = prom["active_days"] / max(data_days, 1)
    prom["rs_per_active_day"] = prom["sale"] / prom["active_days"].replace(0, np.nan)
    if seven:
        l7 = cur[cur["order_date"].dt.date > last_day - dt.timedelta(days=7)].groupby("emp_code")["total"].sum()
        p7 = cur[(cur["order_date"].dt.date <= last_day - dt.timedelta(days=7)) & (cur["order_date"].dt.date > last_day - dt.timedelta(days=14))].groupby("emp_code")["total"].sum()
        prom["last7"] = prom["emp_code"].map(l7).fillna(0); prom["prev7"] = prom["emp_code"].map(p7).fillna(0)
    if has_prev:
        pg = prev.groupby("emp_code")
        pprom = pd.DataFrame({"lmtd": pg["total"].sum(), "p_name": pg["emp_name"].agg(_mode), "p_kae": pg["kae"].agg(_mode),
                              "p_sup": pg["supervisor"].agg(_mode), "p_ch": pg["channel"].agg(_mode),
                              "p_outlet": pg["cust_name"].agg(_mode), "p_code": pg["cust_code"].agg(_mode)}).reset_index()
        prom = prom.merge(pprom, on="emp_code", how="outer")
        stopped = prom["sale"].isna()
        for a, b in (("emp_name", "p_name"), ("kae", "p_kae"), ("supervisor", "p_sup"), ("channel", "p_ch"), ("main_outlet", "p_outlet"), ("outlet_code", "p_code")):
            prom[a] = prom[a].fillna(prom[b])
        prom = prom.drop(columns=["p_name", "p_kae", "p_sup", "p_ch", "p_outlet", "p_code"])
        for c in ("sale", "orders", "qty", "active_days", "sale_last_day", "outlets"):
            prom[c] = prom[c].fillna(0)
        prom["lmtd"] = prom["lmtd"].fillna(0)
        prom["change"] = prom["sale"] - prom["lmtd"]
        prom["growth"] = _growth(prom["sale"], prom["lmtd"])
        prom["stopped"] = stopped
    prom["status"] = "Active"
    prom.loc[prom["sale_last_day"].eq(0) & prom["active_days"].gt(0), "status"] = f"Not punched {last_day:%d-%b}"
    prom.loc[prom["days_since_last_sale"].ge(NO_SALE_DAYS), "status"] = f"No sale {NO_SALE_DAYS}+ days"
    if has_prev:
        prom.loc[prom["stopped"].fillna(False).astype(bool), "status"] = "Stopped (sold last month, nothing now)"
    prom = prom.sort_values("sale", ascending=False).reset_index(drop=True)

    not_punched = prom[(prom["active_days"] > 0) & (prom["sale_last_day"] == 0) & (prom["emp_code"] != NOCODE)].copy()
    no_sale_n = prom[(prom["days_since_last_sale"] >= NO_SALE_DAYS) & (prom["emp_code"] != NOCODE)].sort_values("days_since_last_sale", ascending=False).copy()

    # promoter drops (LMTD first, else last 7 vs previous 7)
    drops = pd.DataFrame()
    if has_prev:
        dd = prom[(prom["lmtd"] >= DROP_MIN_RS) & ((prom["growth"] <= -DROP_PCT) | prom["growth"].isna() & (prom["sale"] == 0))].copy()
        drops = dd.sort_values("change").reset_index(drop=True)
        drops["basis"] = "vs LMTD"
    elif seven:
        prom["change7"] = prom["last7"] - prom["prev7"]
        dd = prom[(prom["prev7"] >= DROP_MIN_RS / 4) & (prom["last7"] <= prom["prev7"] * (1 - DROP_PCT))].copy()
        drops = dd.sort_values("change7").reset_index(drop=True); drops["basis"] = "last 7 vs previous 7 days"

    # never punched (roster from master)
    never = pd.DataFrame()
    if master_pos is not None and len(master_pos) and "emp_code" in master_pos:
        mp = master_pos.copy()
        mp["emp_code"] = mp["emp_code"].fillna("").str.upper()
        active = mp[mp["emp_code"].str.startswith("GL") & ~mp["status"].fillna("").str.lower().str.contains("vacant|maternity|left|resign")]
        never = active[~active["emp_code"].isin(set(cur["emp_code"]))][["emp_code", "emp_name", "kae", "supervisor", "cust_code", "account", "status"]].drop_duplicates()

    # ------------------------------------------------------------- outlets
    og = cur.groupby("cust_code")
    outl = pd.DataFrame({"cust_name": og["cust_name"].agg(_mode), "account": og["account"].agg(_mode), "channel": og["channel"].agg(_mode),
                         "kae": og["kae"].agg(_mode), "supervisor": og["supervisor"].agg(_mode), "state": og["state_name"].agg(_mode),
                         "promoter": og["emp_name"].agg(_mode), "sale": og["total"].sum(), "orders": og["order_ref"].nunique(),
                         "skus": og["prd_code"].nunique(), "days_with_sale": og["order_date"].nunique(), "last_sale": og["order_date"].max()}).reset_index()
    outl["days_since_last_sale"] = (pd.Timestamp(last_day) - outl["last_sale"]).dt.days
    if has_prev:
        po = prev.groupby("cust_code")
        pout = pd.DataFrame({"lmtd": po["total"].sum(), "p_name": po["cust_name"].agg(_mode), "p_acc": po["account"].agg(_mode),
                             "p_ch": po["channel"].agg(_mode), "p_kae": po["kae"].agg(_mode), "p_sup": po["supervisor"].agg(_mode)}).reset_index()
        outl = outl.merge(pout, on="cust_code", how="outer")
        for a, b in (("cust_name", "p_name"), ("account", "p_acc"), ("channel", "p_ch"), ("kae", "p_kae"), ("supervisor", "p_sup")):
            outl[a] = outl[a].fillna(outl[b])
        outl = outl.drop(columns=["p_name", "p_acc", "p_ch", "p_kae", "p_sup"])
        for c in ("sale", "orders", "skus", "days_with_sale"):
            outl[c] = outl[c].fillna(0)
        outl["lmtd"] = outl["lmtd"].fillna(0); outl["change"] = outl["sale"] - outl["lmtd"]; outl["growth"] = _growth(outl["sale"], outl["lmtd"])
    outl = outl.sort_values("sale", ascending=False).reset_index(drop=True)
    outlet_drops = outl[(outl["lmtd"] >= DROP_MIN_RS) & ((outl["growth"] <= -DROP_PCT) | (outl["sale"] == 0))].sort_values("change").reset_index(drop=True) if has_prev else pd.DataFrame()

    # ------------------------------------------------------------- focus SKU gaps (per channel)
    sold = cur[cur["total"] > 0].copy()
    # each outlet is analysed once, in its main channel (an outlet punched under two channels must not be counted twice)
    main_ch = sold.groupby("cust_code")["channel"].agg(_mode)
    sold["channel"] = sold["cust_code"].map(main_ch)
    sku_rows, gap_rows = [], []
    for ch, part in sold.groupby("channel"):
        outlets_ch = part["cust_code"].unique(); n_out = len(outlets_ch)
        if n_out < 5:
            continue
        pen = part.groupby(["prd_code", "prd_name", "brand"])["cust_code"].nunique().reset_index(name="outlets_selling")
        pen["penetration"] = pen["outlets_selling"] / n_out
        per_outlet = part.groupby(["prd_code", "cust_code"])["total"].sum().reset_index()
        med = per_outlet.groupby("prd_code")["total"].median()
        focus = pen[pen["penetration"] >= FOCUS_PENETRATION].copy()
        focus["median_sale_per_outlet"] = focus["prd_code"].map(med)
        focus["outlets_missing"] = n_out - focus["outlets_selling"]
        focus["opportunity"] = focus["outlets_missing"] * focus["median_sale_per_outlet"]
        focus["channel"] = ch
        sku_rows.append(focus)
        sold_sets = part.groupby("cust_code")["prd_code"].agg(set)
        fset = dict(zip(focus["prd_code"], focus["prd_name"])); fmed = dict(zip(focus["prd_code"], focus["median_sale_per_outlet"]))
        for oc, have in sold_sets.items():
            miss = [c for c in fset if c not in have]
            if miss:
                gap_rows.append({"cust_code": oc, "channel": ch, "missing_count": len(miss), "focus_skus": len(fset),
                                 "opportunity": float(sum(fmed[c] for c in miss)),
                                 "missing_skus": ", ".join(sorted(fset[c] for c in miss))})
    focus_skus = pd.concat(sku_rows, ignore_index=True).sort_values("opportunity", ascending=False) if sku_rows else pd.DataFrame()
    gaps = pd.DataFrame(gap_rows)
    if len(gaps):
        gaps = gaps.merge(outl[["cust_code", "cust_name", "account", "kae", "supervisor", "promoter", "sale"]], on="cust_code", how="left")
        assert gaps["cust_code"].is_unique
        gaps = gaps.sort_values("opportunity", ascending=False).reset_index(drop=True)

    # ------------------------------------------------------------- suspicious entries
    sus = []
    if len(cur):
        med_q = cur.groupby("prd_code")["qty"].median()
        thr = np.maximum(QTY_SPIKE_MIN, cur["prd_code"].map(med_q) * QTY_SPIKE_X)
        for r in cur[cur["qty"] >= thr].itertuples():
            sus.append(dict(type="Quantity spike", date=r.order_date.date(), emp_code=r.emp_code, emp_name=r.emp_name, kae=r.kae,
                            supervisor=r.supervisor, cust_name=r.cust_name, detail=f"{int(r.qty)} x {r.prd_name} (usual {med_q.get(r.prd_code, 0):.0f})",
                            amount=float(r.total), order_ref=r.order_ref))
        dup = cur[cur["flags"].fillna("").str.contains("Possible duplicate line")]
        for (ref, prd), grp in dup.groupby(["order_ref", "prd_name"]):
            r = grp.iloc[0]
            sus.append(dict(type="Same SKU punched twice in one order", date=r.order_date.date(), emp_code=r.emp_code, emp_name=r.emp_name, kae=r.kae,
                            supervisor=r.supervisor, cust_name=r.cust_name, detail=f"{len(grp)} identical lines of {prd}", amount=float(grp["total"].sum()), order_ref=ref))
        multi = cur.groupby(["emp_code", cur["order_date"].dt.date])["cust_code"].nunique()
        for (emp, day), n in multi[multi > 1].items():
            if emp == NOCODE: continue
            r = cur[(cur["emp_code"] == emp) & (cur["order_date"].dt.date == day)]
            sus.append(dict(type="Same promoter at several outlets on one day", date=day, emp_code=emp, emp_name=_mode(r["emp_name"]), kae=_mode(r["kae"]),
                            supervisor=_mode(r["supervisor"]), cust_name=", ".join(sorted(r["cust_name"].dropna().unique())[:4]),
                            detail=f"{n} outlets", amount=float(r["total"].sum()), order_ref=""))
        bm = cur[cur["price_diff"] > 0.5]
        for emp, grp in bm.groupby("emp_code"):
            r = grp.iloc[0]
            sus.append(dict(type="Sold below MRP", date=grp["order_date"].max().date(), emp_code=emp, emp_name=_mode(grp["emp_name"]), kae=_mode(grp["kae"]),
                            supervisor=_mode(grp["supervisor"]), cust_name=_mode(grp["cust_name"]),
                            detail=f"{len(grp)} lines, discount {_inr(grp['price_diff'].sum())}", amount=float(grp["total"].sum()), order_ref=""))
    suspicious = pd.DataFrame(sus, columns=["type", "date", "emp_code", "emp_name", "kae", "supervisor", "cust_name", "detail", "amount", "order_ref"])

    # ------------------------------------------------------------- scorecards
    def scorecard(key: str) -> pd.DataFrame:
        gk = cur.groupby([key, "channel"])
        sc = pd.DataFrame({"sale": gk["total"].sum(), "promoters": gk["emp_code"].nunique(), "outlets": gk["cust_code"].nunique(),
                           "promoter_days": cur.groupby([key, "channel", "emp_code"])["order_date"].nunique().groupby(level=[0, 1]).sum()}).reset_index()
        pl = prom[prom["active_days"] > 0]
        sc = sc.merge(pl.groupby([key, "channel"]).apply(lambda x: (x["sale_last_day"] > 0).sum(), include_groups=False).rename("punched_last_day").reset_index(), on=[key, "channel"], how="left")
        cnt = lambda df, name: df.groupby([key, "channel"]).size().rename(name).reset_index()
        for df_, name in ((not_punched, "not_punched"), (no_sale_n, f"no_sale_{NO_SALE_DAYS}d"), (drops, "dropping_promoters"),
                          (suspicious, "suspicious")):
            if len(df_) and key in df_ and "channel" in df_:
                sc = sc.merge(cnt(df_, name), on=[key, "channel"], how="left")
            elif len(df_) and key in df_:
                sc = sc.merge(df_.groupby(key).size().rename(name).reset_index(), on=key, how="left")
            else:
                sc[name] = 0
        if len(gaps) and key in gaps:
            sc = sc.merge(gaps.groupby([key, "channel"]).agg(sku_gaps=("missing_count", "sum"), gap_opportunity=("opportunity", "sum")).reset_index(), on=[key, "channel"], how="left")
        else:
            sc["sku_gaps"] = 0; sc["gap_opportunity"] = 0.0
        if has_prev:
            pk = prev.groupby([key, "channel"])["total"].sum().rename("lmtd").reset_index()
            sc = sc.merge(pk, on=[key, "channel"], how="outer")
            sc["sale"] = sc["sale"].fillna(0); sc["lmtd"] = sc["lmtd"].fillna(0)
            sc["change"] = sc["sale"] - sc["lmtd"]; sc["growth"] = _growth(sc["sale"], sc["lmtd"])
        for c in sc.columns:
            if c not in (key, "channel", "growth") and sc[c].dtype != object:
                sc[c] = sc[c].fillna(0)
        sc["punch_discipline"] = sc["promoter_days"] / (sc["promoters"].replace(0, np.nan) * max(data_days, 1))
        sc["rs_per_promoter_day"] = sc["sale"] / sc["promoter_days"].replace(0, np.nan)
        sc["share"] = sc["sale"] / max(cur["total"].sum(), 1)
        if key == "kae" and target_kae is not None and len(target_kae):
            t = target_kae.groupby("kae")[["target"]].sum().reset_index()
            sc = sc.merge(t, on="kae", how="left")
            sc["target"] = sc["target"].fillna(0)
            sc["ach_pct"] = sc["sale"] / sc["target"].replace(0, np.nan)
        # RAG per row: target vs expected where a target exists; otherwise growth vs LMTD; otherwise punch discipline
        exp = (last_day.day / calendar.monthrange(last_day.year, last_day.month)[1]) if s.day == 1 and s.month == last_day.month else None
        def rag_row(r):
            if exp and r.get("target", 0) and r["target"] > 0:
                a_ = r["sale"] / r["target"]
                return ("Green" if a_ >= exp else "Amber" if a_ >= 0.8 * exp else "Red"), f"Ach% vs expected {exp:.0%}"
            if has_prev:
                g_ = r.get("growth")
                if g_ is None or (isinstance(g_, float) and math.isnan(g_)):
                    return "New", "No LMTD sale"
                return ("Green" if g_ >= 0 else "Amber" if g_ >= -0.10 else "Red"), "Growth vs LMTD"
            pdisc = r["punch_discipline"]
            return ("Green" if pdisc >= 0.85 else "Amber" if pdisc >= 0.7 else "Red"), "Punch discipline"
        rr = sc.apply(rag_row, axis=1, result_type="expand") if len(sc) else pd.DataFrame(columns=[0, 1])
        sc["rag"] = rr[0] if len(sc) else []; sc["rag_basis"] = rr[1] if len(sc) else []
        if key == "supervisor":
            km = cur.groupby("supervisor")["kae"].agg(_mode)
            if has_prev:
                km = km.combine_first(prev.groupby("supervisor")["kae"].agg(_mode))
            sc.insert(1, "kae", sc["supervisor"].map(km))
        sc = sc.sort_values("sale", ascending=False).reset_index(drop=True)
        sc["rank"] = np.arange(1, len(sc) + 1)
        return sc

    kae_sc = scorecard("kae")
    sup_sc = scorecard("supervisor")

    # ------------------------------------------------------------- brand x KAE (share index)
    tot_brand = cur.groupby("brand")["total"].sum(); co_share = tot_brand / max(tot_brand.sum(), 1)
    kb = cur.pivot_table(index="kae", columns="brand", values="total", aggfunc="sum", fill_value=0)
    kb_share = kb.div(kb.sum(axis=1).replace(0, np.nan), axis=0)
    brand_index = (kb_share / co_share).round(2)
    brand_tbl = pd.DataFrame({"sale": tot_brand, "share": co_share}).reset_index()
    if has_prev:
        pb = prev.groupby("brand")["total"].sum()
        brand_tbl["lmtd"] = brand_tbl["brand"].map(pb).fillna(0)
        extra = pd.DataFrame({"brand": [b for b in pb.index if b not in set(brand_tbl["brand"])]})
        if len(extra):
            extra["sale"] = 0.0; extra["share"] = 0.0; extra["lmtd"] = extra["brand"].map(pb)
            brand_tbl = pd.concat([brand_tbl, extra], ignore_index=True)
        brand_tbl["change"] = brand_tbl["sale"] - brand_tbl["lmtd"]; brand_tbl["growth"] = _growth(brand_tbl["sale"], brand_tbl["lmtd"])
    brand_tbl = brand_tbl.sort_values("sale", ascending=False).reset_index(drop=True)

    # ------------------------------------------------------------- daily (with LMTD by day number)
    daily = cur.groupby(cur["order_date"].dt.date).agg(sale=("total", "sum"), promoters=("emp_code", "nunique"), outlets=("cust_code", "nunique")).reset_index()
    daily = daily.rename(columns={"order_date": "date"})
    daily["day_no"] = (pd.to_datetime(daily["date"]) - pd.Timestamp(s)).dt.days + 1
    if has_prev:
        ps = dt.date.fromisoformat(previous_period(start, end)[0])
        pdl = prev.groupby(prev["order_date"].dt.date)["total"].sum().reset_index()
        pdl["day_no"] = (pd.to_datetime(pdl["order_date"]) - pd.Timestamp(ps)).dt.days + 1
        daily = daily.merge(pdl[["day_no", "total"]].rename(columns={"total": "lmtd"}), on="day_no", how="left")
        daily["cum_sale"] = daily["sale"].cumsum(); daily["cum_lmtd"] = daily["lmtd"].fillna(0).cumsum()

    totals = dict(sale=float(cur["total"].sum()), lmtd=float(prev["total"].sum()) if has_prev else None,
                  promoters=int(prom.loc[prom["active_days"] > 0, "emp_code"].nunique()),
                  punched_last_day=int((prom["sale_last_day"] > 0).sum()), outlets=int(cur["cust_code"].nunique()),
                  promoter_days=int(cur.groupby("emp_code")["order_date"].nunique().sum()), data_days=data_days,
                  last_day=last_day.isoformat(), orders=int(cur["order_ref"].nunique()), lines=int(len(cur)))
    out = dict(totals=totals, has_prev=has_prev, promoters=prom, not_punched=not_punched, no_sale=no_sale_n, drops=drops,
               never_punched=never, outlets=outl, outlet_drops=outlet_drops, focus_skus=focus_skus, sku_gaps=gaps,
               suspicious=suspicious, kae_scorecard=kae_sc, supervisor_scorecard=sup_sc, brand=brand_tbl,
               brand_index=brand_index.reset_index(), daily=daily)
    out["actions"] = action_bullets(out)
    return out


def _names(df: pd.DataFrame, n=3, col="emp_name", extra=None) -> str:
    items = []
    for r in df.head(n).itertuples():
        nm = getattr(r, col) or getattr(r, "emp_code", "")
        if extra: nm += f" ({extra(r)})"
        items.append(nm)
    more = len(df) - n
    return ", ".join(items) + (f" +{more} more" if more > 0 else "")


def action_bullets(a: dict) -> list:
    """Specific, ranked actions. Each: {level, area, text, tab}."""
    t = a["totals"]; out = []
    ld = dt.date.fromisoformat(t["last_day"])
    if a["has_prev"] and t["lmtd"]:
        g = t["sale"] / t["lmtd"] - 1
        sc = a["kae_scorecard"].sort_values("change")
        down = sc[sc["change"] < 0].head(3); up = sc[sc["change"] > 0].sort_values("change", ascending=False).head(2)
        txt = f"Sale {_inr(t['sale'])} vs LMTD {_inr(t['lmtd'])} ({g:+.1%}, {_inr(t['sale'] - t['lmtd'])})."
        if len(down):
            txt += " Biggest fall: " + "; ".join(f"{r.kae} {_inr(r.change)}" for r in down.itertuples()) + "."
        if len(up):
            txt += " Growing: " + "; ".join(f"{r.kae} +{_inr(r.change)[0:]}" for r in up.itertuples()) + "."
        out.append(dict(level="red" if g < -0.05 else "amber" if g < 0 else "green", area="Sale vs LMTD", text=txt, tab="scorecard"))
    np_ = a["not_punched"]
    if len(np_):
        by = np_.groupby("kae").size().sort_values(ascending=False)
        lost = (np_["sale"] / np_["active_days"].replace(0, np.nan)).sum()
        out.append(dict(level="red", area="Punching", tab="actions", text=(
            f"{len(np_)} of {t['promoters']} promoters did not punch on {ld:%d-%b} (≈{_inr(lost)} of their usual daily sale). "
            f"By KAE: " + ", ".join(f"{k} {v}" for k, v in by.head(4).items()) + ". "
            f"Top sellers missing: {_names(np_.sort_values('sale', ascending=False), 3, extra=lambda r: r.supervisor)} → call supervisors today.")))
    ns = a["no_sale"]
    if len(ns):
        out.append(dict(level="red", area="Inactive promoters", tab="actions", text=(
            f"{len(ns)} promoters have no sale for {NO_SALE_DAYS}+ days: "
            f"{_names(ns, 4, extra=lambda r: f'{r.main_outlet}, last {r.last_sale:%d-%b}')} → check attendance / stock / replacement.")))
    nv = a["never_punched"]
    if len(nv):
        by = nv.groupby("kae").size().sort_values(ascending=False)
        out.append(dict(level="red", area="Roster", tab="actions", text=(
            f"{len(nv)} active promoters in the roster have not punched a single sale in this period. By KAE: "
            + ", ".join(f"{k} {v}" for k, v in by.head(4).items()) + " → verify app login / deployment.")))
    dr = a["drops"]
    if len(dr):
        col = "change" if "change" in dr else "change7"
        loss = dr[col].sum()
        out.append(dict(level="amber", area="Promoter decline", tab="actions", text=(
            f"{len(dr)} promoters down {DROP_PCT:.0%}+ ({dr['basis'].iloc[0]}), total {_inr(loss)}. Worst: "
            + "; ".join(f"{r.emp_name or r.emp_code} {_inr(getattr(r, col))} ({r.main_outlet})" for r in dr.head(3).itertuples())
            + " → review with supervisor.")))
    od = a["outlet_drops"]
    if len(od):
        out.append(dict(level="amber", area="Outlet decline", tab="outlets", text=(
            f"{len(od)} outlets down {DROP_PCT:.0%}+ vs LMTD ({_inr(od['change'].sum())}). Worst: "
            + "; ".join(f"{r.cust_name} {_inr(r.change)}" for r in od.head(3).itertuples()) + " → check stock / promoter presence.")))
    fs = a["focus_skus"]; gp = a["sku_gaps"]
    if len(fs) and len(gp):
        top = fs.iloc[0]
        kk = gp.groupby("kae")["opportunity"].sum().sort_values(ascending=False)
        out.append(dict(level="amber", area="SKU gaps", tab="outlets", text=(
            f"Focus-SKU gaps worth ≈{_inr(gp['opportunity'].sum())}: {top['prd_name']} not sold in {int(top['outlets_missing'])} {top['channel']} outlets "
            f"(≈{_inr(top['opportunity'])}). Most opportunity: " + ", ".join(f"{k} {_inr(v)}" for k, v in kk.head(3).items())
            + " → push these SKUs / check listing.")))
    bi = a["brand_index"]
    if len(bi) > 1:
        big = a["kae_scorecard"].groupby("kae")["sale"].sum()
        big = set(big[big >= 0.05 * max(t["sale"], 1)].index)        # ignore tiny teams
        idx = bi.set_index("kae"); idx = idx[idx.index.isin(big)]; notes = []
        for brand in a["brand"].head(3)["brand"]:
            if brand in idx:
                low = idx[brand].dropna().sort_values().head(1)
                for k, v in low.items():
                    if v < 0.6:
                        notes.append(f"{k}: {brand} at {v:.0%} of company mix")
        if notes:
            out.append(dict(level="amber", area="Brand mix", tab="brand", text="Under-selling key brands – " + "; ".join(notes) + " → focus brand push in these teams."))
    su = a["suspicious"]
    if len(su):
        sp = su[su["type"] == "Quantity spike"].sort_values("amount", ascending=False)
        txt = f"{len(su)} entries to verify (" + ", ".join(f"{k} {v}" for k, v in su["type"].value_counts().items()) + ")."
        if len(sp):
            r = sp.iloc[0]; txt += f" Biggest spike: {r['emp_name']} – {r['detail']} on {r['date']:%d-%b} ({_inr(r['amount'])})."
        out.append(dict(level="amber", area="Data check", tab="checks", text=txt + " → confirm with supervisor before reporting."))
    sup = a["supervisor_scorecard"]
    if len(sup) > 1:
        w = sup[sup["promoters"] >= 3].sort_values("punch_discipline").head(1)
        if len(w):
            r = w.iloc[0]
            out.append(dict(level="amber", area="Supervisor", tab="scorecard", text=(
                f"Lowest punching discipline: {r['supervisor']} ({r['kae']}) – promoters punched on {r['punch_discipline']:.0%} of days "
                f"({int(r['promoters'])} promoters).")))
    if "ach_pct" in a["kae_scorecard"]:
        red = a["kae_scorecard"][a["kae_scorecard"]["rag"] == "Red"]
        if len(red):
            out.append(dict(level="red", area="Target", tab="scorecard", text=(
                "Behind plan: " + "; ".join(f"{r.kae} {r.ach_pct:.0%}" for r in red.head(4).itertuples() if not (isinstance(r.ach_pct, float) and math.isnan(r.ach_pct))) + ".")))
    return out
