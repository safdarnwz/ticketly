'use strict';

// Builds the website (UI) into dist/ for GitHub Pages. The published site talks to the
// Shelfwise server running in Docker on the viewer's computer (config.json -> serverUrl).
// data/report.json is a fallback snapshot shown when that server isn't running.
//
//   node scripts/build-static.js                 -> demo data (safe to publish)
//   SNAPSHOT_SOURCE=live SD_TOKEN=eyJ... node ...  -> real SalesDiary data (public to anyone with the URL!)
//   SNAPSHOT_START=2026-10-01 SNAPSHOT_END=2026-10-04 to pin the range (default: month to date)

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const upstream = require('../src/upstream');
const { fetchMockReport } = require('../src/mock');
const { toColumnar } = require('../src/columnar');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, filter);
    else if (filter(entry.name)) fs.copyFileSync(s, d);
  }
}

function today() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
  return d.toISOString().slice(0, 10);
}

(async () => {
  const end = process.env.SNAPSHOT_END || today();
  const start = process.env.SNAPSHOT_START || `${end.slice(0, 8)}01`;
  const live = (process.env.SNAPSHOT_SOURCE || 'mock').toLowerCase() === 'live';

  const started = Date.now();
  let res;
  if (live) {
    const creds = { token: config.token, apiBase: config.apiBase };
    if (!creds.token) throw new Error('SNAPSHOT_SOURCE=live needs SD_TOKEN');
    res = await upstream.fetchReport(start, end, creds);
  } else {
    res = await fetchMockReport(start, end);
  }
  const table = toColumnar(res.rows);
  const meta = {
    source: live ? 'live' : 'mock',
    start,
    end,
    rows: res.rows.length,
    total: res.total,
    pages: res.pages,
    upstreamTime: res.upstreamTime,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(path.join(root, 'public'), out);
  copyDir(path.join(root, 'node_modules', 'chart.js', 'dist'), path.join(out, 'vendor', 'chart'), (n) => n === 'chart.umd.min.js');
  const inter = path.join(root, 'node_modules', '@fontsource-variable', 'inter');
  fs.mkdirSync(path.join(out, 'vendor', 'inter'), { recursive: true });
  fs.copyFileSync(path.join(inter, 'index.css'), path.join(out, 'vendor', 'inter', 'index.css'));
  copyDir(path.join(inter, 'files'), path.join(out, 'vendor', 'inter', 'files'), (n) => n.includes('-wght-normal'));
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.writeFileSync(path.join(out, 'data', 'report.json'), JSON.stringify({ meta, ...table }));
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  // Where the published UI looks for the Shelfwise server (users can change it on the site).
  // publicServer (e.g. the ngrok domain) lets the site work on any computer, not just this one.
  let site = {};
  try {
    site = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
  } catch {
    /* optional */
  }
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({
    serverUrl: process.env.PAGES_SERVER_URL || 'http://localhost:8080',
    publicServer: process.env.PAGES_PUBLIC_SERVER || site.publicServer || '',
  }));

  console.log(`dist/ ready · ${meta.source} data · ${start}..${end} · ${meta.rows} rows`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
