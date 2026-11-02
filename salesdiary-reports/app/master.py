"""Optional outlet / roster master (gives exact Account, KAE, Supervisor and Target per store).

Accepted inputs
1. The "Attendance & Sale" workbook: any sheet whose header row (within the first 15 rows) has
   "SD Store ID" and "Target" (columns: SD Store ID, Account Name, KAE/ASM, Supervisor/SO/ISR, RM,
   Channel Name, Target, User ID, EMP NAME, Status).
2. A simple CSV / XLSX with columns: cust_code, account, kae, supervisor, rsm, channel, target.
Targets equal to the store number (copy-paste error seen in the source file) or below 1,000 are set to 0 and flagged.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pandas as pd

ALIASES = {
    "cust_code": ["sd store id", "cust_code", "store id", "outlet code", "rcode", "store code"],
    "account": ["account name", "account"],
    "kae": ["kae/asm", "kae", "asm"],
    "supervisor": ["supervisor/so/isr", "supervisor", "team lead", "team_lead"],
    "rsm": ["rm", "rsm"],
    "channel": ["channel name", "channel"],
    "target": ["target"],
    "emp_code": ["user id", "emp_code", "emp code"],
    "emp_name": ["emp name", "emp_name", "name"],
    "status": ["status"],
}
MIN_TARGET = 1000


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower()) if s is not None else ""


def _find_header(df: pd.DataFrame) -> int | None:
    for i in range(min(15, len(df))):
        vals = {_norm(v) for v in df.iloc[i].tolist()}
        if any(a in vals for a in ALIASES["cust_code"]) and "target" in vals:
            return i
    return None


def read_master(content: bytes, filename: str) -> tuple[pd.DataFrame, list[str]]:
    """Return (positions dataframe with standard columns, list of notes)."""
    notes = []
    name = filename.lower()
    frames = []
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        book = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None, dtype=object)
        for sheet, df in book.items():
            h = _find_header(df)
            if h is not None:
                body = df.iloc[h + 1:].copy(); body.columns = [str(c).strip() if c is not None else "" for c in df.iloc[h]]
                frames.append((sheet, body))
    elif name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content), dtype=object, header=None)
        h = _find_header(df)
        if h is not None:
            body = df.iloc[h + 1:].copy(); body.columns = [str(c).strip() for c in df.iloc[h]]
            frames.append(("csv", body))
    else:
        raise ValueError("Master must be .xlsx or .csv")
    if not frames:
        raise ValueError("No sheet with a 'SD Store ID' (or cust_code) and 'Target' header found in the master file.")
    sheet, body = frames[0]
    notes.append(f"Master read from sheet '{sheet}' ({len(body)} rows).")
    out = pd.DataFrame()
    lower = {_norm(c): c for c in body.columns}
    for std, al in ALIASES.items():
        col = next((lower[a] for a in al if a in lower), None)
        out[std] = body[col] if col is not None else None
    out = out[out["cust_code"].notna() | out["emp_name"].notna()].copy()
    for c in out.columns:
        if c != "target":
            out[c] = out[c].map(lambda v: re.sub(r"\s+", " ", str(v)).strip() if pd.notna(v) and str(v).strip() not in ("", "nan") else None)
    out["target_raw"] = pd.to_numeric(out["target"], errors="coerce")
    num = out["cust_code"].fillna("").str.extract(r"(\d+)$")[0].astype(float)
    bad = out["target_raw"].notna() & ((out["target_raw"] == num) | (out["target_raw"] < MIN_TARGET))
    out["target_flag"] = None
    out.loc[bad & (out["target_raw"] == num), "target_flag"] = "Target = store number (invalid)"
    out.loc[bad & (out["target_raw"] != num), "target_flag"] = "Target below 1,000 (invalid)"
    out.loc[out["target_raw"].isna() | (out["target_raw"] == 0), "target_flag"] = "No target"
    out["target"] = out["target_raw"].where(~bad, 0).fillna(0)
    if bad.sum():
        notes.append(f"{int(bad.sum())} invalid targets set to 0 (equal to store number or below 1,000).")
    out["cust_code"] = out["cust_code"].map(lambda v: None if v in (None, "-") else v)
    return out.reset_index(drop=True), notes


def store_level(pos: pd.DataFrame) -> pd.DataFrame:
    """One row per store: first non-null attributes, target summed over positions."""
    p = pos[pos["cust_code"].notna()]
    first = lambda s: next((x for x in s if x), None)
    agg = p.groupby("cust_code").agg(account=("account", first), kae=("kae", first), supervisor=("supervisor", first),
                                     rsm=("rsm", first), channel=("channel", first), target=("target", "sum"),
                                     positions=("cust_code", "size")).reset_index()
    return agg


def save_master(content: bytes, filename: str, folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("master.*"):
        old.unlink()
    ext = Path(filename).suffix.lower() or ".xlsx"
    path = folder / f"master{ext}"
    path.write_bytes(content)
    return path


def load_saved(folder: Path):
    for p in folder.glob("master.*"):
        return p.read_bytes(), p.name
    return None
