"""Build a realistic synthetic response (same schema as SalesDiary) with deliberate edge cases.
Includes the 10 rows the user shared, plus generated rows. No real token or credential is involved."""
import json, random, datetime as dt
from pathlib import Path

USER_ROWS = json.loads((Path(__file__).parent / "user_sample_rows.json").read_text())

def generate(n_orders=None, start="2026-10-01", end="2026-10-31", seed=7):
    """Realistic month: every promoter has a fixed team and home outlet, punches on ~90% of days, 1-3 orders a day.
    Some outlets never sell some SKUs (gives SKU gaps). n_orders is ignored (kept for compatibility)."""
    rnd = random.Random(seed)
    base = USER_ROWS
    teams = [("Lead A", "KAE North Team", "MT", "Karnataka", "South"), ("Lead C", "KAE Delhi Team", "MT", "Delhi", "North"),
             ("Lead F", "KAE Haryana Team", "SAMT", "Haryana", "North"), ("Lead B", "KAE South Team", "MT", "Tamil Nadu", "South"),
             ("Lead D", "KAE West Team", "SAMT", "Maharashtra", "West"), (None, "RSM Kerala Team", "MT", "Kerala", "South")]
    outlets = [("MTDM5703", "Dmart_Attawara Mangalore"), ("MTHG20", "H&G Malleshwaram"), ("MTLO104", "Lots Sarita Vihar"),
               ("SAZE66", "ZEE NOVELTIES"), ("SASA14", "SANGAM MEGA MART"), ("MTLU9411", "Lulu Global Mall"), ("MTWE079", "Borivali store"),
               ("MTPO32", "Pothys Hypermarket"), ("MTXX1", "Unknown chain"), ("MTDM5105", "Dmart Hebbal"), ("MTHG53", "H&G Kammanahalli"),
               ("SAKW24", "Kwality Bazar"), ("MTDM3004", "Dmart Pratap Nagar"), ("SABE276", "Beauty Park")]
    prods = [(r["prd_id"], r["prd_code"], r["prd_name"], r["mrp"], r["categ"], r["brand"]) for r in base]
    prods = list({p[1]: p for p in prods}.values())
    weights = [5, 3, 6, 4, 2, 6, 3, 1][:len(prods)]
    promoters = []
    for k in range(24):
        tl, parent, ch, state, reg = teams[k % len(teams)]
        promoters.append(dict(emp=k, team=(tl, parent, ch, state, reg), outlet=outlets[k % len(outlets)],
                              alt=outlets[(k + 5) % len(outlets)] if k in (6, 13) else None, skill=rnd.uniform(0.6, 1.4)))
    no_sell = {o[0]: set(rnd.sample([p[1] for p in prods], 2)) for o in outlets}
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    rows, k = [], 0
    day = s
    while day <= e:
        for pr in promoters:
            if rnd.random() > (0.72 if day.weekday() == 6 else 0.92):
                continue
            for _ in range(rnd.randint(1, 3)):
                k += 1
                tl, parent, ch, state, reg = pr["team"]
                code, name = pr["alt"] if pr["alt"] and rnd.random() < 0.3 else pr["outlet"]
                lines = []
                for _ in range(rnd.randint(1, 3)):
                    choices = [p for p in prods if p[1] not in no_sell[code]]
                    pid, pc, pn, mrp, cat, br = rnd.choices(choices, weights=[weights[prods.index(p)] for p in choices])[0]
                    if any(l["prd_code"] == pc for l in lines):
                        continue
                    q = max(1, int(round(rnd.randint(1, 3) * pr["skill"])))
                    tot = mrp * q if rnd.random() > 0.05 else round(mrp * q * 0.9)
                    lines.append(dict(base[0], order_date=day.isoformat(), order_ref=f"O-{seed}-{k}", cust_code=code, cust_name=name,
                                      outlet_type=ch, state_name=state, region=reg if rnd.random() > 0.05 else "Default",
                                      emp_name=f"Promoter {pr['emp']}" + (" " if pr['emp'] % 5 == 0 else ""), emp_code=f"GL{1800000 + pr['emp']}",
                                      team_lead=tl, team_name=(tl + " Team") if tl else None, parent_name=parent, prd_id=pid, prd_code=pc, prd_name=pn,
                                      mrp=mrp, categ=cat, brand=br, family=pn, qty=q, subtotal=str(tot), tax="0", total=tot))
                ot = sum(l["total"] for l in lines)
                for l in lines:
                    l["order_config_json"] = {"freight_value": 0, "order": {"total": ot, "tax": 0, "sub_total": ot}}
                rows.extend(lines)
        day += dt.timedelta(days=1)
    # edge cases
    rows[5]["total"] = 0; rows[5]["subtotal"] = "0"                      # zero amount
    rows[6]["order_date"] = (s - dt.timedelta(days=1)).isoformat()       # outside range
    rows[7]["emp_code"] = None                                            # missing salesman
    rows[8]["subtotal"] = "1,234"                                         # comma number as text
    rows.append(dict(rows[9]))                                            # exact duplicate line inside an order
    rows[10]["order_config_json"] = {"order": {"total": rows[10]["total"] + 500}}   # order with a missing line
    return rows


def scenario():
    """Sep (LMTD) + Oct (current) with realistic problems: promoters who stop punching late in the month,
    one promoter who sold in Sep but not in Oct, a team that declines, and a quantity spike."""
    oct_rows = generate()
    sep_rows = generate(start="2026-09-01", end="2026-09-30", seed=11)
    for r in sep_rows:
        if r["emp_code"] == "GL1800019":
            r["emp_name"] = "Promoter 19"
    # Promoter 19 stops completely in Oct; promoters 3 and 4 stop punching after 26-Oct; team KAE West sells less in Oct
    oct_rows = [r for r in oct_rows if r["emp_code"] != "GL1800019"]
    oct_rows = [r for r in oct_rows if not (r["emp_code"] in ("GL1800003", "GL1800004") and r["order_date"] > "2026-10-26")]
    oct_rows = [r for i, r in enumerate(oct_rows) if not (r["parent_name"] == "KAE West Team" and i % 3 == 0)]
    spike = dict(oct_rows[20]); spike["qty"] = 48; spike["total"] = spike["mrp"] * 48; spike["subtotal"] = str(spike["total"])
    spike["order_ref"] = "O-SPIKE-1"; spike["order_config_json"] = {"order": {"total": spike["total"]}}
    oct_rows.append(spike)
    return USER_ROWS + oct_rows + sep_rows

if __name__ == "__main__":
    out = {"results": {"status": 200, "msg": "success", "data": {"prd_attr": [], "sales": scenario()}}}
    Path(__file__).with_name("sample_response.json").write_text(json.dumps(out, indent=1))
    print(len(out["results"]["data"]["sales"]))
