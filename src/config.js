'use strict';

const fs = require('fs');
const path = require('path');

// Minimal .env loader so the app runs with plain `node server.js` (no dotenv dependency).
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const env = process.env;

module.exports = {
  port: Number(env.PORT || 8080),
  host: env.HOST || '0.0.0.0',
  // live = call SalesDiary, mock = generated demo data, auto = live when a token is set
  dataSource: process.argv.includes('--demo') ? 'mock' : (env.DATA_SOURCE || 'auto').toLowerCase(),
  apiBase: (env.SD_API_BASE || 'https://inx11.salesdiary.in:4071').replace(/\/+$/, ''),
  reportPath: env.SD_REPORT_PATH || '/api/pwa_reports/getStockAvailablityReport',
  token: (env.SD_TOKEN || '').trim(),
  // Login flow: company key -> instance (sdlogin), then username/password -> token (instance)
  loginBase: (env.SD_LOGIN_BASE || 'https://sdlogin.salesdiary.in:2001').replace(/\/+$/, ''),
  companyPath: env.SD_COMPANY_PATH || '/api/sd_companies/findcompanyinstancewithlogo',
  loginPath: env.SD_LOGIN_PATH || '/api/res_users/instance_pwa_login',
  pwaVersion: env.SD_PWA_VERSION || '293',
  defaultCompany: env.SD_COMPANY_KEY || '',
  // true = everyone signs in with their SalesDiary account; false = SD_TOKEN is shared by all viewers
  requireLogin: (env.REQUIRE_LOGIN || 'true') === 'true',
  // Signed-in sessions expire after this much inactivity (hours)
  sessionHours: Number(env.SESSION_HOURS || 12),
  origin: env.SD_ORIGIN || 'https://app.salesdiary.in',
  pageSize: Number(env.SD_PAGE_SIZE || 5000),
  // id = next page starts after the last row id, offset = row offset, none = single call
  pagination: (env.SD_PAGINATION || 'id').toLowerCase(),
  maxPages: Number(env.SD_MAX_PAGES || 40),
  timeoutMs: Number(env.SD_TIMEOUT_MS || 60000),
  // Upstream responses are cached this long; every browser polling every 5 s shares one call.
  cacheTtlMs: Number(env.CACHE_TTL_MS || 4000),
  allowTokenUpdate: (env.ALLOW_TOKEN_UPDATE || 'true') === 'true',
  // The UI lives on GitHub Pages; these origins may call this server from the browser.
  corsOrigins: (env.CORS_ORIGINS || 'https://safdarnwz.github.io').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
  // Where the UI is published (shown when someone opens the server URL directly).
  dashboardUrl: env.DASHBOARD_URL || 'https://safdarnwz.github.io/ticketly/',
  // Also serve the UI from this server (handy for local development). Docker runs API-only.
  serveUi: process.argv.includes('--ui') || (env.SERVE_UI || 'false') === 'true',
  // Set both to require a login (recommended whenever the dashboard is on a public URL).
  basicAuth: env.DASHBOARD_USER && env.DASHBOARD_PASSWORD ? `${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}` : null,
};
