"""Background job runner: fetch -> Spark clean -> report. One job runs at a time (one Spark session)."""
from __future__ import annotations

import datetime as dt
import json
import threading
import traceback
import uuid
from pathlib import Path

import pandas as pd

from . import actions, config, master as master_mod, report, spark_clean
from .fetcher import Fetcher, FetchError

JOBS: dict[str, dict] = {}
_run_lock = threading.Lock()


def _job_dir(job_id: str) -> Path:
    d = config.RUNS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _set(job_id, **kw):
    JOBS[job_id].update(kw)
    meta = {k: v for k, v in JOBS[job_id].items() if k not in ("token",)}
    (_job_dir(job_id) / "status.json").write_text(json.dumps(meta, default=str))


def create(start: str, end: str, source: str) -> str:
    job_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    JOBS[job_id] = dict(id=job_id, start=start, end=end, source=source, stage="queued", message="Waiting to start",
                        pages=0, rows=0, error=None, created=dt.datetime.now().isoformat(timespec="seconds"))
    _set(job_id)
    return job_id


def run(job_id: str, token: str | None, rows: list | None, master_blob: tuple | None,
        compare: bool = True, prev_rows: list | None = None):
    """token -> live API pull; rows -> offline JSON upload. master_blob = (bytes, filename) or None.
    compare -> also pull the same days of last month (LMTD) for growth / drop analysis."""
    with _run_lock:
        j = JOBS[job_id]
        d = _job_dir(job_id)
        try:
            fetch_meta, warnings = {}, []
            p_start, p_end = actions.previous_period(j["start"], j["end"])
            if rows is None:
                _set(job_id, stage="fetch", message="Connecting to SalesDiary…")
                raw_dir = d / "raw"
                if config.KEEP_RAW_JSON: raw_dir.mkdir(exist_ok=True)

                def sink_for(tag):
                    def sink(i, page):
                        if config.KEEP_RAW_JSON:
                            (raw_dir / f"{tag}_page_{i:05d}.json").write_text(json.dumps(page, ensure_ascii=False))
                    return sink

                def prog_for(label):
                    def prog(p):
                        _set(job_id, pages=p["pages"], rows=p["rows"], message=f"{label}: {p['pages']} pages, {p['rows']:,} rows")
                    return prog

                res = Fetcher(token, j["start"], j["end"], progress=prog_for("Current period"), raw_sink=sink_for("cur")).run()
                rows = res.rows
                fetch_meta = {"Current period": f"{j['start']} to {j['end']}", "Pages requested": res.pages, "Offset mode": res.offset_mode,
                              "Rows received": res.raw_rows, "Repeated pages ignored": res.overlap_dropped, "Rows used": len(rows)}
                if compare:
                    try:
                        _set(job_id, message=f"Fetching LMTD {p_start} to {p_end}…")
                        pres = Fetcher(token, p_start, p_end, progress=prog_for("LMTD"), raw_sink=sink_for("lmtd")).run()
                        prev_rows = pres.rows
                        fetch_meta.update({"LMTD period": f"{p_start} to {p_end}", "LMTD rows": len(prev_rows)})
                    except FetchError as e:
                        warnings.append(f"LMTD could not be fetched ({e}); report shows current period only.")
                token = None  # drop the token as soon as fetching is done
            else:
                fetch_meta = {"Source": "uploaded JSON", "Rows used": len(rows)}
                if prev_rows:
                    fetch_meta.update({"LMTD period": f"{p_start} to {p_end}", "LMTD rows": len(prev_rows)})
            _set(job_id, rows=len(rows), stage="clean", message=f"Cleaning {len(rows):,} rows with PySpark…")

            master_store, master_pos, notes = None, None, []
            if master_blob:
                master_pos, notes = master_mod.read_master(*master_blob)
                master_store = master_mod.store_level(master_pos)
            res = spark_clean.clean(rows, j["start"], j["end"], master_store)
            prev_clean = None
            if prev_rows:
                _set(job_id, message=f"Cleaning LMTD ({len(prev_rows):,} rows)…")
                prev_clean = spark_clean.clean(prev_rows, p_start, p_end, master_store)
            _set(job_id, stage="report", message="Building action dashboard and Excel…")
            res = report.enrich(res, j["start"], j["end"])
            act = actions.build(res["clean"], prev_clean["clean"] if prev_clean else None, j["start"], j["end"],
                                master_pos, res.get("target_kae"))
            res["checks"] += report.action_checks(act, res, prev_clean)
            meta = dict(start=j["start"], end=j["end"], lmtd_start=p_start if prev_clean else None, lmtd_end=p_end if prev_clean else None,
                        generated=dt.datetime.now().strftime("%d-%b-%Y %H:%M"), rows=len(rows), fetch=fetch_meta,
                        master_notes=notes, master=bool(master_blob), job_id=job_id, warnings=warnings)
            (d / "dashboard.json").write_text(json.dumps(report.dashboard_json(res, act, meta), default=str))
            xlsx = d / f"SalesDiary_Actions_{j['start']}_to_{j['end']}.xlsx"
            report.write_excel(res, act, meta, xlsx)
            res["clean"].to_csv(d / "clean_data.csv", index=False)
            ok = all(c["result"] == "OK" for c in res["checks"])
            _set(job_id, stage="done", message="Ready" + ("" if ok else " – some control checks need review") + ("" if not warnings else " (LMTD missing)"),
                 excel=xlsx.name, checks_ok=ok, finished=dt.datetime.now().isoformat(timespec="seconds"))
        except FetchError as e:
            _set(job_id, stage="error", error=str(e), message=str(e))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            _set(job_id, stage="error", error=f"{e.__class__.__name__}: {e}", message="Unexpected error – see server log")
        finally:
            token = None


def load_existing():
    if not config.RUNS_DIR.exists():
        return
    for st in sorted(config.RUNS_DIR.glob("*/status.json"))[-50:]:
        try:
            meta = json.loads(st.read_text())
            if meta.get("stage") not in ("done", "error"):
                meta.update(stage="error", error="Server restarted while this job was running", message="Interrupted")
            JOBS[meta["id"]] = meta
        except Exception:  # noqa: BLE001
            pass
