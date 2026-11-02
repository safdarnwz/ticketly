"""Build a realistic synthetic response (same schema as SalesDiary) with deliberate edge cases.
Includes the 10 rows the user shared, plus generated rows. No real token or credential is involved."""
import json, random, datetime as dt
from pathlib import Path

USER_ROWS = json.loads((Path(__file__).parent / "user_sample_rows.json").read_text())

def generate(n_orders=400, start="2026-10-01", end="2026-10-31", seed=7):
    rnd = random.Random(seed)
    base = USER_ROWS
    teams = [("Lead A", "KAE North Team", "MT", "Karnataka", "South"), ("Lead C", "KAE Delhi Team", "MT", "Delhi", "North"),
             ("Lead F", "KAE Haryana Team", "SAMT", "Haryana", "North"), ("Lead B", "KAE South Team", "MT", "Tamil Nadu", "South"),
             ("Lead D", "KAE West Team", "SAMT", "Maharashtra", "West"), (None, "RSM Kerala Team", "MT", "Kerala", "South")]
    outlets = [("MTDM5703", "Dmart_Attawara Mangalore"), ("MTHG20", "H&G Malleshwaram"), ("MTLO104", "Lots Sarita Vihar"),
               ("SAZE66", "ZEE NOVELTIES"), ("SASA14", "SANGAM MEGA MART"), ("MTLU9411", "Lulu Global Mall"), ("MTWE079", "Borivali store"),
               ("MTPO32", "Pothys Hypermarket"), ("MTXX1", "Unknown chain")]
    prods = [(r["prd_id"], r["prd_code"], r["prd_name"], r["mrp"], r["categ"], r["brand"]) for r in base]
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    rows = []
    for k in range(n_orders):
        day = s + dt.timedelta(days=rnd.randrange((e - s).days + 1))
        tl, parent, ch, state, reg = rnd.choice(teams)
        code, name = rnd.choice(outlets)
        emp = rnd.randrange(20)
        lines = []
        for _ in range(rnd.randint(1, 4)):
            pid, pc, pn, mrp, cat, br = rnd.choice(prods)
            q = rnd.randint(1, 4)
            tot = mrp * q if rnd.random() > 0.08 else round(mrp * q * 0.9)
            lines.append(dict(base[0], order_date=day.isoformat(), order_ref=f"O-{k}-{day:%Y%m%d}", cust_code=code, cust_name=name,
                              outlet_type=ch, state_name=state, region=reg if rnd.random() > 0.1 else "Default",
                              emp_name=f"Promoter {emp}" + (" " if emp % 5 == 0 else ""), emp_code=f"GL{1800000 + emp}",
                              team_lead=tl, team_name=(tl or "X") + " Team", parent_name=parent, prd_id=pid, prd_code=pc, prd_name=pn,
                              mrp=mrp, categ=cat, brand=br, family=pn, qty=q, subtotal=str(tot), tax="0", total=tot))
        ot = sum(l["total"] for l in lines)
        for l in lines:
            l["order_config_json"] = {"freight_value": 0, "order": {"total": ot, "tax": 0, "sub_total": ot}}
        rows.extend(lines)
    # edge cases
    rows[5]["total"] = 0; rows[5]["subtotal"] = "0"                      # zero amount
    rows[6]["order_date"] = "2026-09-30"                                  # outside range
    rows[7]["emp_code"] = None                                            # missing salesman
    rows[8]["subtotal"] = "1,234"                                         # comma number as text
    rows.append(dict(rows[9]))                                            # exact duplicate line inside page
    rows[10]["order_config_json"] = {"order": {"total": rows[10]["total"] + 500}}   # order with a missing line
    return rows

if __name__ == "__main__":
    out = {"results": {"status": 200, "msg": "success", "data": {"prd_attr": [], "sales": USER_ROWS + generate()}}}
    Path(__file__).with_name("sample_response.json").write_text(json.dumps(out, indent=1))
    print(len(out["results"]["data"]["sales"]))
