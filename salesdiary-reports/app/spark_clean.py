"""PySpark cleaning + aggregation of SalesDiary tertiary sales lines.

Input: list of raw JSON rows (as returned by the API). Output: pandas DataFrames for the dashboard / Excel.
Every aggregate is built from the same cleaned Spark DataFrame, and Control Checks compare every total
back to the raw rows, so nothing can silently drop out.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import threading

import pandas as pd
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import StringType, StructField, StructType

from . import config

_spark = None
_lock = threading.Lock()

RAW_FIELDS = ["order_date", "order_ref", "cust_id", "cust_name", "cust_code", "cust_district", "program_type",
              "outlet_type", "state_name", "role", "emp_name", "emp_code", "team_lead", "prd_id", "prd_code",
              "prd_name", "mrp", "categ", "brand", "family", "discount", "region", "region_manager", "cluster",
              "cluster_manager", "territory", "territory_manager", "ter_code", "team_name", "parent_name", "qty",
              "uom", "subtotal", "tax", "total", "margin"]
EXTRA_FIELDS = ["order_total", "order_subtotal", "order_tax", "freight_value", "source_row"]
NUMERIC = ["mrp", "discount", "qty", "subtotal", "tax", "total", "margin", "order_total", "order_subtotal",
           "order_tax", "freight_value"]

STATE_ZONE = {
    "delhi": "North", "haryana": "North", "punjab": "North", "uttar pradesh": "North", "uttarakhand": "North",
    "himachal pradesh": "North", "jammu and kashmir": "North", "chandigarh": "North", "rajasthan": "North",
    "karnataka": "South", "tamil nadu": "South", "kerala": "South", "telangana": "South", "andhra pradesh": "South",
    "puducherry": "South", "maharashtra": "West", "gujarat": "West", "goa": "West", "madhya pradesh": "West",
    "chhattisgarh": "West", "west bengal": "East", "odisha": "East", "bihar": "East", "jharkhand": "East",
    "assam": "East", "meghalaya": "East", "tripura": "East", "manipur": "East", "mizoram": "East",
    "nagaland": "East", "sikkim": "East", "arunachal pradesh": "East",
}


def spark() -> SparkSession:
    global _spark
    with _lock:
        if _spark is None:
            os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
            os.environ.setdefault("PYSPARK_DRIVER_PYTHON", sys.executable)
            _spark = (SparkSession.builder.master(os.getenv("SPARK_MASTER", "local[*]"))
                      .appName("salesdiary-reports")
                      .config("spark.ui.enabled", "false")
                      .config("spark.sql.shuffle.partitions", os.getenv("SPARK_SHUFFLE_PARTITIONS", "8"))
                      .config("spark.driver.memory", os.getenv("SPARK_DRIVER_MEMORY", "2g"))
                      .config("spark.sql.session.timeZone", "Asia/Kolkata")
                      .getOrCreate())
            _spark.sparkContext.setLogLevel("ERROR")
        return _spark


def _flatten(rows: list) -> list:
    """Flatten nested order_config_json and stringify everything so Spark never mis-infers a type."""
    out = []
    for i, r in enumerate(rows):
        oc = r.get("order_config_json") or {}
        if isinstance(oc, str):
            try:
                import json; oc = json.loads(oc)
            except ValueError:
                oc = {}
        order = oc.get("order") or {}
        rec = {k: r.get(k) for k in RAW_FIELDS}
        rec.update(order_total=order.get("total"), order_subtotal=order.get("sub_total"), order_tax=order.get("tax"),
                   freight_value=oc.get("freight_value"), source_row=i)
        out.append(tuple(None if v is None else str(v) for v in (rec[k] for k in RAW_FIELDS + EXTRA_FIELDS)))
    return out


def _clean_str(c):
    s = F.regexp_replace(F.trim(F.col(c)), r"\s+", " ")
    return F.when((s == "") | (F.lower(s).isin("null", "none", "nan", "na", "-")), None).otherwise(s)


def _account_from_prefix(code_col):
    expr = None
    for p in sorted(config.ACCOUNT_PREFIX, key=len, reverse=True):
        cond = F.upper(code_col).startswith(p)
        expr = F.when(cond, F.lit(config.ACCOUNT_PREFIX[p])) if expr is None else expr.when(cond, F.lit(config.ACCOUNT_PREFIX[p]))
    return expr.otherwise(F.lit("Unmapped"))


def clean(rows: list, start: str, end: str, master_store: pd.DataFrame | None = None) -> dict:
    sp = spark()
    schema = StructType([StructField(c, StringType(), True) for c in RAW_FIELDS + EXTRA_FIELDS])
    raw = sp.createDataFrame(_flatten(rows), schema) if rows else sp.createDataFrame([], schema)
    raw_count = raw.count()

    df = raw
    for c in RAW_FIELDS:
        if c not in NUMERIC:
            df = df.withColumn(c, _clean_str(c))
    for c in NUMERIC:
        df = df.withColumn(c, F.regexp_replace(F.col(c), ",", "").cast("double"))
    df = (df.withColumn("source_row", F.col("source_row").cast("int"))
            .withColumn("order_date_raw", F.col("order_date"))
            .withColumn("order_date", F.coalesce(F.to_date("order_date", "yyyy-MM-dd"), F.to_date("order_date", "dd-MM-yyyy"),
                                                 F.to_date(F.substring("order_date", 1, 10), "yyyy-MM-dd")))
            .withColumn("qty", F.coalesce(F.col("qty"), F.lit(0.0)))
            .withColumn("total", F.coalesce(F.col("total"), F.col("subtotal") + F.coalesce(F.col("tax"), F.lit(0.0)), F.lit(0.0)))
            .withColumn("channel", F.upper(F.coalesce(F.col("outlet_type"), F.lit("UNKNOWN"))))
            .withColumn("kae_api", F.regexp_replace(F.coalesce(F.col("parent_name"), F.lit("No Parent Team")), r"(?i)\s+team$", ""))
            .withColumn("supervisor", F.coalesce(F.col("team_lead"), F.regexp_replace(F.col("team_name"), r"(?i)\s+team$", ""), F.lit("No Team Lead")))
            .withColumn("emp_code", F.upper(F.col("emp_code")))
            .withColumn("cust_code", F.upper(F.col("cust_code")))
            .withColumn("mrp_value", F.col("mrp") * F.col("qty"))
            .withColumn("price_diff", F.round(F.col("mrp_value") - F.col("total"), 2))
            .withColumn("zone_from_state", F.lit(None).cast("string")))
    zone_map = F.create_map(*[x for kv in STATE_ZONE.items() for x in (F.lit(kv[0]), F.lit(kv[1]))])
    df = df.withColumn("zone_from_state", zone_map[F.lower(F.col("state_name"))])

    # account / KAE: exact master match first, prefix rule second
    if master_store is not None and len(master_store):
        mcols = ["cust_code", "account", "kae", "supervisor", "rsm", "channel"]
        mrows = [tuple(None if (v is None or (isinstance(v, float) and v != v)) else str(v).strip() for v in rec)
                 for rec in master_store[mcols].itertuples(index=False)]
        mrows = [(r[0].upper(),) + r[1:] for r in mrows if r[0]]
        m = sp.createDataFrame(mrows, StructType([StructField(c, StringType(), True) for c in
                                                  ["cust_code", "m_account", "m_kae", "m_supervisor", "m_rsm", "m_channel"]]))
        m = m.dropDuplicates(["cust_code"])
        df = df.join(F.broadcast(m), "cust_code", "left")
    else:
        for c in ("m_account", "m_kae", "m_supervisor", "m_rsm", "m_channel"):
            df = df.withColumn(c, F.lit(None).cast("string"))
    df = (df.withColumn("account", F.coalesce(F.col("m_account"), _account_from_prefix(F.coalesce(F.col("cust_code"), F.lit("")))))
            .withColumn("account_source", F.when(F.col("m_account").isNotNull(), "master").otherwise("prefix rule"))
            .withColumn("kae", F.coalesce(F.col("m_kae"), F.col("kae_api")))
            .withColumn("rsm", F.col("m_rsm")))

    # order integrity: lines of an order should add up to the order total in order_config_json
    w = Window.partitionBy("order_ref")
    df = (df.withColumn("order_lines_sum", F.sum("total").over(w))
            .withColumn("order_total_api", F.max("order_total").over(w))
            .withColumn("order_gap", F.round(F.col("order_total_api") - F.col("order_lines_sum"), 2)))
    dup_w = Window.partitionBy("order_ref", "prd_id", "qty", "total", "emp_code", "order_date")
    df = df.withColumn("dup_n", F.count(F.lit(1)).over(dup_w))

    s_date, e_date = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    flags = [
        ("Invalid / missing date", F.col("order_date").isNull()),
        ("Date outside requested range", F.col("order_date").isNotNull() & ((F.col("order_date") < F.lit(s_date)) | (F.col("order_date") > F.lit(e_date)))),
        ("Missing salesman code", F.col("emp_code").isNull()),
        ("Missing outlet code", F.col("cust_code").isNull()),
        ("Missing product", F.col("prd_code").isNull() & F.col("prd_name").isNull()),
        ("Zero / negative quantity", F.col("qty") <= 0),
        ("Zero / negative amount", F.col("total") <= 0),
        ("Amount above MRP x Qty", F.col("total") > F.col("mrp_value") + 0.5),
        ("Sold below MRP", F.col("price_diff") > 0.5),
        ("Order lines do not add up to order total", F.col("order_total_api").isNotNull() & (F.abs(F.col("order_gap")) > 0.5)),
        ("Possible duplicate line (same order, SKU, qty, amount)", F.col("dup_n") > 1),
        ("Region does not match state", F.col("zone_from_state").isNotNull() & F.col("region").isNotNull() & (F.col("region") != F.col("zone_from_state"))),
        ("Account from prefix rule (no master)", F.col("account_source") == "prefix rule"),
        ("Account needs review", F.col("account").contains("check") | (F.col("account") == "Unmapped")),
    ]
    arr = F.array(*[F.when(cond, F.lit(name)) for name, cond in flags])
    df = df.withColumn("flags", F.concat_ws("; ", arr)).cache()
    clean_count = df.count()

    def agg_pd(sdf: DataFrame) -> pd.DataFrame:
        return sdf.toPandas()

    days_in_range = (e_date - s_date).days + 1
    base_metrics = [F.round(F.sum("total"), 2).alias("sales"), F.sum("qty").alias("qty"),
                    F.countDistinct("order_ref").alias("orders"), F.count(F.lit(1)).alias("lines"),
                    F.countDistinct("emp_code").alias("promoters"), F.countDistinct("cust_code").alias("outlets"),
                    F.countDistinct("order_date").alias("days_with_sale")]

    kpi = agg_pd(df.agg(*base_metrics, F.countDistinct("prd_code").alias("skus"), F.min("order_date").alias("first_date"),
                        F.max("order_date").alias("last_date"), F.round(F.sum("mrp_value"), 2).alias("mrp_value"))).iloc[0].to_dict()

    daily = agg_pd(df.groupBy("order_date").agg(*base_metrics).orderBy("order_date"))
    # promoter-days: a promoter is "active" on a day when they punched at least one sale
    pdays = df.groupBy("kae", "channel", "supervisor", "emp_code").agg(F.countDistinct("order_date").alias("active_days"))
    kae = (df.groupBy("kae", "channel").agg(*base_metrics)
             .join(pdays.groupBy("kae", "channel").agg(F.sum("active_days").alias("promoter_days")), ["kae", "channel"], "left")
             .orderBy(F.desc("sales")))
    sup = (df.groupBy("supervisor", "kae", "channel").agg(*base_metrics)
             .join(pdays.groupBy("supervisor", "kae", "channel").agg(F.sum("active_days").alias("promoter_days")), ["supervisor", "kae", "channel"], "left")
             .orderBy(F.desc("sales")))
    name_w = Window.partitionBy("emp_code").orderBy(F.desc("n"))
    names = (df.groupBy("emp_code", "emp_name").agg(F.count(F.lit(1)).alias("n"))
               .withColumn("rk", F.row_number().over(name_w)).filter("rk = 1").select("emp_code", "emp_name"))
    prom = (df.groupBy("emp_code").agg(
                F.first("supervisor", True).alias("supervisor"), F.first("kae", True).alias("kae"), F.first("channel", True).alias("channel"),
                F.first("role", True).alias("role"), F.countDistinct("cust_code").alias("outlets"),
                F.concat_ws(", ", F.array_sort(F.collect_set("cust_code"))).alias("outlet_codes"),
                F.countDistinct("emp_name").alias("name_variants"),
                F.countDistinct("order_date").alias("active_days"), F.countDistinct("order_ref").alias("orders"),
                F.count(F.lit(1)).alias("lines"), F.sum("qty").alias("qty"), F.round(F.sum("total"), 2).alias("sales"),
                F.min("order_date").alias("first_sale"), F.max("order_date").alias("last_sale"))
              .join(names, "emp_code", "left")
              .withColumn("days_since_last_sale", F.datediff(F.lit(e_date), F.col("last_sale")))
              .orderBy(F.desc("sales")))
    outlet = (df.groupBy("cust_code").agg(
                F.first("cust_name", True).alias("cust_name"), F.first("account", True).alias("account"),
                F.first("account_source", True).alias("account_source"), F.first("channel", True).alias("channel"),
                F.first("state_name", True).alias("state"), F.first("cust_district", True).alias("district"),
                F.first("kae", True).alias("kae"), F.countDistinct("emp_code").alias("promoters"),
                F.countDistinct("order_date").alias("days_with_sale"), F.countDistinct("order_ref").alias("orders"),
                F.countDistinct("prd_code").alias("skus"), F.sum("qty").alias("qty"), F.round(F.sum("total"), 2).alias("sales"),
                F.max("order_date").alias("last_sale"))
              .withColumn("days_since_last_sale", F.datediff(F.lit(e_date), F.col("last_sale")))
              .orderBy(F.desc("sales")))
    brand = agg_pd(df.groupBy("brand").agg(*base_metrics).orderBy(F.desc("sales")))
    categ = agg_pd(df.groupBy("brand", "categ").agg(*base_metrics).orderBy(F.desc("sales")))
    sku = agg_pd(df.groupBy("prd_code", "prd_name", "brand", "categ").agg(F.max("mrp").alias("mrp"), *base_metrics).orderBy(F.desc("sales")))
    account = agg_pd(df.groupBy("account", "channel").agg(*base_metrics).orderBy(F.desc("sales")))
    acc_brand = agg_pd(df.groupBy("account").pivot("brand").agg(F.round(F.sum("total"), 2)).na.fill(0))
    state = agg_pd(df.groupBy("state_name", "zone_from_state").agg(*base_metrics).orderBy(F.desc("sales")))
    daily_brand = agg_pd(df.groupBy("order_date").pivot("brand").agg(F.round(F.sum("total"), 2)).na.fill(0).orderBy("order_date"))
    channel = agg_pd(df.groupBy("channel").agg(*base_metrics).orderBy(F.desc("sales")))

    quality_rows = []
    for name, _ in flags:
        q = df.filter(F.col("flags").contains(name))
        n = q.count()
        if n:
            quality_rows.append({"issue": name, "lines": n, "amount": float(q.agg(F.sum("total")).first()[0] or 0),
                                 "orders": q.select("order_ref").distinct().count()})
    quality = pd.DataFrame(quality_rows, columns=["issue", "lines", "amount", "orders"])
    order_gaps = agg_pd(df.filter(F.abs(F.col("order_gap")) > 0.5)
                         .groupBy("order_ref")
                         .agg(F.min("order_date").alias("order_date"), F.first("emp_code", True).alias("emp_code"),
                              F.first("emp_name", True).alias("emp_name"), F.first("cust_code", True).alias("cust_code"),
                              F.first("cust_name", True).alias("cust_name"), F.count(F.lit(1)).alias("lines_received"), F.round(F.max("order_lines_sum"), 2).alias("lines_sum"),
                              F.round(F.max("order_total_api"), 2).alias("order_total"), F.round(F.max("order_gap"), 2).alias("gap"))
                         .orderBy(F.desc("gap")))

    clean_cols = ["order_date", "order_ref", "cust_code", "cust_name", "account", "account_source", "channel", "state_name",
                  "zone_from_state", "cust_district", "region", "cluster", "territory", "kae", "supervisor", "emp_code", "emp_name",
                  "role", "brand", "categ", "prd_code", "prd_name", "mrp", "qty", "mrp_value", "discount", "total", "price_diff",
                  "order_total_api", "order_gap", "flags", "source_row"]
    clean_pd = agg_pd(df.select(*clean_cols).orderBy("order_date", "order_ref", "source_row"))

    pdays_pd = agg_pd(pdays)
    result = dict(kpi=kpi, daily=daily, kae=agg_pd(kae), supervisor=agg_pd(sup), promoter=agg_pd(prom), outlet=agg_pd(outlet),
                  brand=brand, categ=categ, sku=sku, account=account, account_brand=acc_brand, state=state,
                  daily_brand=daily_brand, channel=channel, quality=quality, order_gaps=order_gaps, clean=clean_pd,
                  promoter_days=pdays_pd, counts=dict(raw=raw_count, clean=clean_count), days_in_range=days_in_range)

    # target vs achievement (only with a master): store targets roll up to master KAE; unmapped sales shown separately
    if master_store is not None and len(master_store):
        st_sales = clean_pd.groupby("cust_code", dropna=False)["total"].sum().rename("achievement").reset_index()
        ms = master_store.copy(); ms["cust_code"] = ms["cust_code"].str.upper()
        merged = ms.merge(st_sales, on="cust_code", how="outer", indicator=True)
        merged["achievement"] = merged["achievement"].fillna(0); merged["target"] = merged["target"].fillna(0)
        merged["kae"] = merged["kae"].fillna("Not in master (unmapped sale)")
        merged["channel"] = merged["channel"].fillna("—")
        tva = merged.groupby(["kae", "channel"], dropna=False).agg(stores=("cust_code", "nunique"), target=("target", "sum"),
                                                                     achievement=("achievement", "sum")).reset_index()
        stores_no_sale = merged[(merged["_merge"] == "left_only")]
        result["target_store"] = merged.drop(columns="_merge")
        result["target_kae"] = tva.sort_values("achievement", ascending=False)
        result["stores_no_sale"] = stores_no_sale.drop(columns="_merge")
    df.unpersist()
    return result
