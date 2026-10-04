'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const config = require('./src/config');
const upstream = require('./src/upstream');
const { fetchMockReport } = require('./src/mock');
const { toColumnar } = require('./src/columnar');
const sessions = require('./src/sessions');

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_ROOTS = {
  '/vendor/chart/': path.join(__dirname, 'node_modules', 'chart.js', 'dist'),
  '/vendor/inter/': path.join(__dirname, 'node_modules', '@fontsource-variable', 'inter'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Which data a request may see:
//   mock   - demo data (no SalesDiary call)
//   live   - the signed-in user's own SalesDiary session
//   shared - SD_TOKEN from .env, only when REQUIRE_LOGIN=false
function resolveSource(session) {
  if (config.dataSource === 'mock') return { mode: 'mock' };
  if (session) return session.mode === 'demo' ? { mode: 'mock' } : { mode: 'live', session };
  if (!config.requireLogin) {
    if (config.token && config.dataSource !== 'mock') return { mode: 'shared', creds: { token: config.token, apiBase: config.apiBase } };
    if (config.dataSource !== 'live') return { mode: 'mock' };
  }
  return null;
}

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('base64url').slice(0, 12);

// ---------- report cache: one upstream call per range + token per TTL ----------

const cache = new Map();

function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function fetchLive(src, start, end) {
  if (src.mode === 'shared') return upstream.fetchReport(start, end, src.creds);
  return upstream.fetchReport(start, end, { token: src.session.token, apiBase: config.apiBase });
}

async function loadReport(src, start, end) {
  const scope = src.mode === 'mock' ? 'mock' : src.mode === 'shared' ? `shared|${hash(src.creds.token)}` : `live|${src.session.id}|${hash(src.session.token)}`;
  const key = `${scope}|${start}|${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < config.cacheTtlMs) return hit.promise;

  const started = Date.now();
  const promise = (src.mode === 'mock' ? fetchMockReport(start, end) : fetchLive(src, start, end)).then((res) => {
    const table = toColumnar(res.rows);
    const meta = {
      source: src.mode === 'mock' ? 'mock' : 'live',
      start,
      end,
      rows: res.rows.length,
      total: res.total,
      pages: res.pages,
      upstreamTime: res.upstreamTime,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    const body = JSON.stringify({ meta, ...table });
    // ETag ignores meta, so an unchanged dataset is answered with 304.
    const etag = '"' + crypto.createHash('sha1').update(JSON.stringify(table)).digest('base64url') + '"';
    return { body, etag, meta };
  });

  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return promise;
}

function clearCacheFor(session) {
  for (const k of cache.keys()) if (k.includes(`|${session.id}|`)) cache.delete(k);
}

// ---------- http helpers ----------

function send(req, res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const type = headers['Content-Type'] || 'application/json; charset=utf-8';
  const accepts = String(req.headers['accept-encoding'] || '');
  const compressible = /json|text|javascript|svg/.test(type) && buf.length > 1024;
  const out = { 'Content-Type': type, ...headers };
  let payload = buf;
  if (compressible && accepts.includes('br')) {
    payload = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    out['Content-Encoding'] = 'br';
  } else if (compressible && accepts.includes('gzip')) {
    payload = zlib.gzipSync(buf, { level: 6 });
    out['Content-Encoding'] = 'gzip';
  }
  out['Content-Length'] = payload.length;
  if (compressible) out.Vary = 'Accept-Encoding';
  res.writeHead(status, out);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let file = null;
  for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
    if (pathname.startsWith(prefix)) file = path.join(dir, pathname.slice(prefix.length));
  }
  if (!file) file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const allowed = [PUBLIC_DIR, ...Object.values(STATIC_ROOTS)].some((root) => file.startsWith(root + path.sep));
  if (!allowed) return send(req, res, 403, { error: 'Forbidden' });

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      // Unknown non-asset routes fall back to the app shell.
      if (!path.extname(pathname)) return serveStatic(req, res, '/');
      return send(req, res, 404, { error: 'Not found' });
    }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    const cacheControl = pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache';
    fs.readFile(file, (readErr, data) => {
      if (readErr) return send(req, res, 500, { error: 'Read failed' });
      send(req, res, 200, data, { 'Content-Type': type, ETag: etag, 'Cache-Control': cacheControl });
    });
  });
}

// ---------- routes ----------

async function jsonBody(req) {
  try {
    return JSON.parse((await readBody(req)) || '{}');
  } catch {
    return null;
  }
}

// ---------- public address (Cloudflare quick tunnel or PUBLIC_URL) ----------

let tunnel = { url: null, at: 0 };
async function publicUrl() {
  if (config.publicUrl) return config.publicUrl;
  if (!config.tunnelMetricsUrl) return null;
  if (Date.now() - tunnel.at < 15000) return tunnel.url;
  tunnel.at = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${config.tunnelMetricsUrl}/quicktunnel`, { signal: controller.signal });
    clearTimeout(t);
    const json = await res.json();
    tunnel.url = json.hostname ? `https://${json.hostname}` : null;
  } catch {
    tunnel.url = null;
  }
  return tunnel.url;
}

function shareLink(url) {
  if (!url) return null;
  const base = config.dashboardUrl.replace(/\/?$/, '/');
  return `${base}?server=${url}`;
}

async function statusPayload(session) {
  const src = resolveSource(session);
  const tokenInfo = src?.mode === 'live' ? upstream.decodeToken(session.token) : src?.mode === 'shared' ? upstream.decodeToken(config.token) : null;
  return {
    // true = each browser pastes its own SalesDiary token in the box at the top of the page
    needsToken: config.requireLogin && config.dataSource !== 'mock',
    authenticated: Boolean(src),
    source: src ? (src.mode === 'mock' ? 'mock' : 'live') : null,
    mode: src?.mode || null,
    apiBase: src && src.mode !== 'mock' ? config.apiBase : null,
    token: tokenInfo,
    allowTokenUpdate: config.allowTokenUpdate,
    cacheTtlMs: config.cacheTtlMs,
    publicUrl: await publicUrl(),
    shareLink: shareLink(await publicUrl()),
  };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const session = sessions.get(req);

  if (p === '/api/health') return send(req, res, 200, { ok: true, uptime: process.uptime() });

  if (p === '/api/status') return send(req, res, 200, await statusPayload(session));

  if (p === '/api/auth/demo' && req.method === 'POST') {
    if (session) sessions.destroy(req);
    const { session: created, cookie } = sessions.create(req, { mode: 'demo' });
    return send(req, res, 200, { ok: true, session: created.id }, { 'Set-Cookie': cookie });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    if (session) clearCacheFor(session);
    return send(req, res, 200, { ok: true }, { 'Set-Cookie': sessions.destroy(req) });
  }

  // The token box at the top of the page: paste the SalesDiary "authorization" token.
  if (p === '/api/auth/token' && req.method === 'POST') {
    if (!config.allowTokenUpdate) return send(req, res, 403, { error: 'Pasting a token is disabled on this server.' });
    const body = await jsonBody(req);
    const token = String(body?.token || '').replace(/^(Bearer|authorization:?)\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
    if (!upstream.JWT_RE.test(token)) return send(req, res, 400, { error: 'That doesn’t look like a SalesDiary token. It should start with eyJ…' });
    const info = upstream.decodeToken(token);
    if (info?.expired) return send(req, res, 400, { error: `This token expired at ${new Date(info.exp).toLocaleString('en-IN')}. Copy a fresh one from SalesDiary.` });
    if (session?.mode === 'live') {
      session.token = token;
      clearCacheFor(session);
      return send(req, res, 200, { ok: true, token: info });
    }
    if (session) sessions.destroy(req);
    const { session: created, cookie } = sessions.create(req, { mode: 'live', token });
    console.log(`[token] new session${info?.instance ? ` for ${info.instance}` : ''}${info?.exp ? `, valid till ${new Date(info.exp).toISOString()}` : ''}`);
    return send(req, res, 200, { ok: true, session: created.id, token: info }, { 'Set-Cookie': cookie });
  }

  if (p === '/api/report') {
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    if (!isDate(start) || !isDate(end)) return send(req, res, 400, { error: 'start and end must be YYYY-MM-DD' });
    if (start > end) return send(req, res, 400, { error: 'start must be on or before end' });
    const src = resolveSource(session);
    if (!src) return send(req, res, 401, { error: 'Paste your SalesDiary token in the box at the top.', code: 'login_required' });
    try {
      const report = await loadReport(src, start, end);
      const headers = { ETag: report.etag, 'Cache-Control': 'no-cache, private', 'X-Fetched-At': report.meta.fetchedAt };
      if (req.headers['if-none-match'] === report.etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      return send(req, res, 200, report.body, headers);
    } catch (err) {
      const status = err.status || 500;
      console.error(`[report] ${start}..${end} -> ${status} ${err.message}`);
      return send(req, res, status, { error: err.message, code: err.code });
    }
  }

  return send(req, res, 404, { error: 'Unknown endpoint' });
}

// Optional password gate for when the dashboard is exposed on a public URL.
function authorized(req) {
  if (!config.basicAuth) return true;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  const given = Buffer.from(header.slice(6), 'base64');
  const expected = Buffer.from(config.basicAuth);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// ---------- CORS: the UI on GitHub Pages calls this server from the browser ----------

function applyCors(req, res) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (!origin) return false;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local && !config.corsOrigins.includes(origin) && !config.corsOrigins.includes('*')) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Fetched-At');
  return true;
}

function landingPage() {
  const link = config.dashboardUrl.replace(/[&<>"]/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shelfwise server</title>
<style>body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f6f3;color:#0b0b0b;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:440px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{color:#52514e;margin:0 0 16px}a{display:inline-block;background:#0b0b0b;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}p{color:#c3c2b7}a{background:#fff;color:#0b0b0b}}</style></head>
<body><main><h1>The Shelfwise server is running.</h1><p>This computer serves the data. The dashboard itself is on GitHub Pages and connects here automatically.</p><a href="${link}">Open the dashboard</a></main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cors = url.pathname.startsWith('/api/') && applyCors(req, res);
  if (req.method === 'OPTIONS') {
    if (!cors) {
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session, If-None-Match',
      'Access-Control-Max-Age': '600',
      // Chrome asks before a public site (github.io) may talk to localhost.
      ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
    });
    return res.end();
  }
  if (url.pathname !== '/api/health' && !authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Shelfwise", charset="UTF-8"', 'Content-Type': 'text/plain' });
    return res.end('Authentication required');
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'Method not allowed' });
    if (!config.serveUi) return send(req, res, 200, landingPage(), { 'Content-Type': 'text/html; charset=utf-8' });
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(req, res, 500, { error: 'Internal error' });
  }
});

server.listen(config.port, config.host, () => {
  const mode = config.dataSource === 'mock' ? 'DEMO data only' : config.requireLogin ? `paste a token on the page · ${config.apiBase}` : config.token ? `shared token, ${config.apiBase}` : 'DEMO data (no SD_TOKEN set)';
  console.log(`Shelfwise running on http://localhost:${config.port}  ·  ${mode}${config.basicAuth ? '  ·  password protected' : ''}`);
  console.log(config.serveUi ? `UI also served here: http://localhost:${config.port}` : `API only. Dashboard: ${config.dashboardUrl}  (allowed origins: ${config.corsOrigins.join(', ')})`);
  announcePublicUrl();
});

// Print the link for other computers once the tunnel (if any) has an address.
async function announcePublicUrl(tries = 0) {
  if (!config.publicUrl && !config.tunnelMetricsUrl) return;
  tunnel.at = 0;
  const url = await publicUrl();
  if (url) {
    console.log(`Public server address: ${url}`);
    console.log(`Open on any computer:  ${shareLink(url)}`);
  } else if (tries < 40) setTimeout(() => announcePublicUrl(tries + 1), 3000);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
