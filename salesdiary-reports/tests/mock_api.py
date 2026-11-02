"""Tiny stand-in for the SalesDiary endpoint (for local end-to-end testing only).
Run: python tests/mock_api.py  -> http://127.0.0.1:4071/api/pwa_reports/tertiarySalesReport (row offsets, 50 rows/page)."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROWS = json.loads((Path(__file__).parent / "fixtures" / "sample_response.json").read_text())["results"]["data"]["sales"]
PAGE = 50

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not self.headers.get("authorization"):
            self.send_response(401); self.end_headers(); return
        s, e = body["start_date"], body["end_date"]
        rows = [r for r in ROWS if s <= r["order_date"] <= e]
        off = int(body["offset"])
        out = {"results": {"status": 200, "msg": "success", "data": {"prd_attr": [], "sales": rows[off:off + PAGE]}}}
        data = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 4071), H).serve_forever()
