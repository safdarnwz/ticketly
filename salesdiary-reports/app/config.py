"""Runtime settings. Everything can be overridden with environment variables (see .env.example)."""
import os
from pathlib import Path

API_BASE = os.getenv("SD_API_BASE", "https://inx11.salesdiary.in:4071").rstrip("/")
TERTIARY_PATH = os.getenv("SD_TERTIARY_PATH", "/api/pwa_reports/tertiarySalesReport")
REFERER = os.getenv("SD_REFERER", "https://app.salesdiary.in/")
USER_AGENT = os.getenv(
    "SD_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
)
REQUEST_TIMEOUT = int(os.getenv("SD_TIMEOUT_SECONDS", "120"))
MAX_PAGES = int(os.getenv("SD_MAX_PAGES", "5000"))
MAX_RETRIES = int(os.getenv("SD_MAX_RETRIES", "4"))
# auto = detect whether "offset" is a row offset or a page number; or force "row" / "page"
OFFSET_MODE = os.getenv("SD_OFFSET_MODE", "auto")
VERIFY_TLS = os.getenv("SD_VERIFY_TLS", "true").lower() != "false"

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
RUNS_DIR = DATA_DIR / "runs"
MASTER_DIR = DATA_DIR / "master"
KEEP_RAW_JSON = os.getenv("KEEP_RAW_JSON", "true").lower() == "true"
MAX_RANGE_DAYS = int(os.getenv("MAX_RANGE_DAYS", "92"))

# Store-code prefix -> account. Used only when no outlet master is uploaded; such rows are marked "prefix rule".
# Prefixes checked longest-first. Built from the Glenmark Account Retailer Mapping (MTHG has 4 Walmart stores and
# MTWE is split Reliance / Wellness Forever, so those two are flagged for review).
ACCOUNT_PREFIX = {
    "MTDM": "DMart", "MTLU": "Lulu", "MTLO": "Lots", "FRDB": "Lots", "MTNE": "Nesto", "MTPO": "Pothys",
    "MTSA": "Sarvana", "MTRE": "Reliance", "MTME": "Metro", "MTVM": "Vmart", "MTWA": "Walmart",
    "MTHG": "H&G", "MTWE": "Wellness Forever / Reliance (check)", "MTCA": "Check (Reliance / Hypermax)",
    "SA": "SAMT", "SB": "SAMT",
}
