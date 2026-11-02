"""Background job runner: fetch -> Spark clean -> report. One job runs at a time (one Spark session)."""
from __future__ import annotations

import datetime as dt
import json
import threading
import traceback
import uuid
from pathlib import Path

import pandas as pd

from . import config, master as master_mod, report, spark_clean
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


def run(job_id: str, token: str | None, rows: list | None, master_blob: tuple | None):
    """token -> live API pull; rows -> offline JSON upload. master_blob = (bytes, filename) or None."""
    with _run_lock:
        j = JOBS[job_id]
        d = _job_dir(job_id)
        try:
            fetch_meta = {}
            if rows is None:
                _set(job_id, stage="fetch", message="Connecting to SalesDiary…")
                raw_dir = d / "raw"
                if config.KEEP_RAW_JSON: raw_dir.mkdir(exist_ok=True)

                def sink(i, page):
                    if config.KEEP_RAW_JSON:
                        (raw_dir / f"page_{i:05d}.json").write_text(json.dumps(page, ensure_ascii=False))

                def prog(p):
                    _set(job_id, pages=p["pages"], rows=p["rows"], message=f"Fetched {p['pages']} pages, {p['rows']:,} rows")

                res = Fetcher(token, j["start"], j["end"], progress=prog, raw_sink=sink).run()
                token = None  # drop the token as soon as fetching is done
                rows = res.rows
                fetch_meta = {"Pages requested": res.pages, "Offset mode": res.offset_mode, "Rows received": res.raw_rows,
                              "Repeated pages ignored": res.overlap_dropped, "Rows used": len(rows)}
            else:
                fetch_meta = {"Source": "uploaded JSON", "Rows used": len(rows)}
            _set(job_id, rows=len(rows), stage="clean", message=f"Cleaning {len(rows):,} rows with PySpark…")

            master_store, notes = None, []
            if master_blob:
                pos, notes = master_mod.read_master(*master_blob)
                master_store = master_mod.store_level(pos)
            res = spark_clean.clean(rows, j["start"], j["end"], master_store)
            _set(job_id, stage="report", message="Building dashboard and Excel…")
            res = report.enrich(res, j["start"], j["end"])
            meta = dict(start=j["start"], end=j["end"], generated=dt.datetime.now().strftime("%d-%b-%Y %H:%M"), rows=len(rows),
                        fetch=fetch_meta, master_notes=notes, master=bool(master_blob), job_id=job_id)
            (d / "dashboard.json").write_text(json.dumps(report.dashboard_json(res, meta), default=str))
            xlsx = d / f"SalesDiary_Tertiary_{j['start']}_to_{j['end']}.xlsx"
            report.write_excel(res, meta, xlsx)
            res["clean"].to_csv(d / "clean_data.csv", index=False)
            ok = all(c["result"] == "OK" for c in res["checks"])
            _set(job_id, stage="done", message="Ready" + ("" if ok else " – some control checks need review"), excel=xlsx.name,
                 checks_ok=ok, finished=dt.datetime.now().isoformat(timespec="seconds"))
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
