"""FastAPI app: serves the HTML/JS dashboard and the job API."""
from __future__ import annotations

import datetime as dt
import json
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, jobs, master as master_mod

app = FastAPI(title="SalesDiary Reports", docs_url=None, redoc_url=None)
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.on_event("startup")
def _startup():
    config.RUNS_DIR.mkdir(parents=True, exist_ok=True)
    config.MASTER_DIR.mkdir(parents=True, exist_ok=True)
    jobs.load_existing()


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/healthz")
def health():
    return {"ok": True}


def _check_dates(start: str, end: str):
    try:
        s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    if e < s:
        raise HTTPException(400, "End date is before start date")
    if (e - s).days + 1 > config.MAX_RANGE_DAYS:
        raise HTTPException(400, f"Range is longer than {config.MAX_RANGE_DAYS} days – split it or raise MAX_RANGE_DAYS")
    if s > dt.date.today() + dt.timedelta(days=1):
        raise HTTPException(400, "Start date is in the future")


async def _master(master: UploadFile | None, save: bool):
    if master is not None and master.filename:
        blob = await master.read()
        if not blob:
            return None
        try:
            master_mod.read_master(blob, master.filename)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"Master file problem: {e}")
        if save:
            master_mod.save_master(blob, master.filename, config.MASTER_DIR)
        return blob, master.filename
    return master_mod.load_saved(config.MASTER_DIR)


@app.post("/api/jobs")
async def start_job(token: str = Form(...), start_date: str = Form(...), end_date: str = Form(...),
                    master: UploadFile | None = File(None), save_master: bool = Form(False)):
    _check_dates(start_date, end_date)
    blob = await _master(master, save_master)
    job_id = jobs.create(start_date, end_date, "api")
    threading.Thread(target=jobs.run, args=(job_id, token, None, blob), daemon=True).start()
    return {"job_id": job_id}


@app.post("/api/jobs/upload")
async def upload_job(files: list[UploadFile] = File(...), start_date: str = Form(...), end_date: str = Form(...),
                     master: UploadFile | None = File(None), save_master: bool = Form(False)):
    """Offline mode: build the same dashboard from saved JSON response(s)."""
    _check_dates(start_date, end_date)
    rows, seen_pages = [], set()
    for f in files:
        try:
            body = json.loads(await f.read())
        except ValueError:
            raise HTTPException(400, f"{f.filename} is not valid JSON")
        data = body.get("results", body).get("data", body) if isinstance(body, dict) else body
        page = data.get("sales", []) if isinstance(data, dict) else data
        sig = hash(json.dumps(page, sort_keys=True, default=str))
        if sig in seen_pages:       # the same page uploaded twice is skipped; identical rows inside data are kept
            continue
        seen_pages.add(sig); rows.extend(page)
    if not rows:
        raise HTTPException(400, "No sales rows found in the uploaded file(s)")
    blob = await _master(master, save_master)
    job_id = jobs.create(start_date, end_date, "upload")
    threading.Thread(target=jobs.run, args=(job_id, None, rows, blob), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs")
def list_jobs():
    items = sorted(jobs.JOBS.values(), key=lambda j: j["id"], reverse=True)[:30]
    return [{k: v for k, v in j.items() if k != "token"} for j in items]


def _job(job_id: str) -> dict:
    j = jobs.JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "Job not found")
    return j


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    return {k: v for k, v in _job(job_id).items() if k != "token"}


@app.get("/api/jobs/{job_id}/dashboard")
def job_dashboard(job_id: str):
    _job(job_id)
    p = config.RUNS_DIR / job_id / "dashboard.json"
    if not p.exists():
        raise HTTPException(409, "Dashboard not ready")
    return JSONResponse(json.loads(p.read_text()))


@app.get("/api/jobs/{job_id}/excel")
def job_excel(job_id: str):
    j = _job(job_id)
    if j.get("stage") != "done":
        raise HTTPException(409, "Report not ready")
    p = config.RUNS_DIR / job_id / j["excel"]
    return FileResponse(p, filename=p.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/jobs/{job_id}/csv")
def job_csv(job_id: str):
    j = _job(job_id)
    p = config.RUNS_DIR / job_id / "clean_data.csv"
    if not p.exists():
        raise HTTPException(409, "Not ready")
    return FileResponse(p, filename=f"clean_data_{j['start']}_to_{j['end']}.csv", media_type="text/csv")


@app.get("/api/master")
def master_info():
    saved = master_mod.load_saved(config.MASTER_DIR)
    return {"saved": bool(saved), "name": saved[1] if saved else None}


@app.delete("/api/master")
def master_delete():
    for p in config.MASTER_DIR.glob("master.*"):
        p.unlink()
    return {"saved": False}
