'use strict';

const config = require('./config');

class UpstreamError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const JWT_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

// Reads the JWT payload (no signature check - only used to show expiry/profile in the UI).
function decodeToken(token) {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const d = payload.data || {};
    return {
      exp: payload.exp ? payload.exp * 1000 : null,
      expired: payload.exp ? payload.exp * 1000 < Date.now() : false,
      profile: d.profile || null,
      instance: d.instance || null,
      userId: d.user_id || null,
    };
  } catch {
    return null;
  }
}

function browserHeaders(extra = {}) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: config.origin,
    Referer: config.origin + '/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    ...extra,
  };
}

async function postJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', signal: controller.signal, headers: browserHeaders(headers), body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* handled below */
    }
    return { status: res.status, json, text };
  } catch (err) {
    if (err.name === 'AbortError') throw new UpstreamError('SalesDiary request timed out.', 504);
    throw new UpstreamError(`Could not reach SalesDiary: ${err.cause?.code || err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- response helpers: the login APIs' exact shapes vary, so search them ----------

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  for (const [k, v] of Object.entries(node)) {
    visit(k, v);
    if (v && typeof v === 'object') walk(v, visit, depth + 1);
  }
}

function findValue(node, keys, test = (v) => typeof v === 'string' && v.trim() !== '') {
  const wanted = keys.map((k) => k.toLowerCase());
  let found;
  for (const key of wanted) {
    walk(node, (k, v) => {
      if (found === undefined && k.toLowerCase() === key && test(v)) found = v;
    });
    if (found !== undefined) return found;
  }
  return undefined;
}

function findJwt(node) {
  const preferred = findValue(node, ['token', 'access_token', 'accessToken', 'jwt', 'auth_token'], (v) => typeof v === 'string' && JWT_RE.test(v));
  if (preferred) return preferred;
  let any;
  walk(node, (_k, v) => {
    if (!any && typeof v === 'string' && JWT_RE.test(v)) any = v;
  });
  return any;
}

function messageOf(json) {
  return findValue(json, ['msg', 'message', 'error', 'err', 'error_message']) || null;
}

function statusOf(json) {
  const s = findValue(json, ['status'], (v) => typeof v === 'number' || /^\d+$/.test(String(v)));
  return s == null ? null : Number(s);
}

// ---------- step 1: company key -> instance, API url, logo ----------

async function findCompany(companyKey) {
  const { status, json } = await postJson(config.loginBase + config.companyPath, { companyKey });
  if (!json) throw new UpstreamError(`Company lookup failed (${status}).`, 502);
  const st = statusOf(json);
  if (status >= 400 || (st && st !== 200)) throw new UpstreamError(messageOf(json) || 'Company not found.', 404);

  const isUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
  const url = findValue(json, ['url', 'instance_url', 'api_url', 'server_url', 'base_url', 'node_url', 'app_url'], isUrl);
  const instance = findValue(json, ['instance', 'instance_name', 'ckey', 'company_key', 'key']) || companyKey;
  const logo = findValue(json, ['logo', 'logo_url', 'company_logo', 'image', 'logo_path'], (v) => typeof v === 'string' && /^(https?:|data:image)/.test(v));
  const name = findValue(json, ['company_name', 'name', 'display_name', 'title']) || companyKey;
  if (!url && !json) throw new UpstreamError('Company not found.', 404);
  return {
    companyKey,
    instance,
    name,
    logo: logo || null,
    apiBase: (url || config.apiBase).replace(/\/+$/, ''),
  };
}

// ---------- step 2: username + password -> token ----------

async function login({ companyKey, instance, apiBase, username, password }) {
  const body = {
    instance,
    ckey: companyKey,
    url: apiBase,
    token: null,
    login_type: null,
    user_name: username,
    password,
    otp: null,
    device_name: '',
    device_info: { ip_address: '0.0.0.0', name: '12345678', browser: '', os: '', device_token: null },
    pwa_version: config.pwaVersion,
    access_token: null,
    sso_name: '',
    user: null,
  };
  const { status, json } = await postJson(apiBase + config.loginPath, body);
  if (!json) throw new UpstreamError(`Login failed (${status}).`, 502);
  const token = findJwt(json);
  if (!token) {
    const msg = messageOf(json);
    throw new UpstreamError(msg && !/^success$/i.test(msg) ? msg : 'Wrong username or password.', 401, 'login_failed');
  }
  const displayName = findValue(json, ['full_name', 'name', 'user_full_name', 'display_name', 'user_name']) || username;
  return { token, displayName };
}

// ---------- report ----------

function buildPayload({ start, end, offsetID, token, apiBase }) {
  return {
    start_date: start,
    end_date: end,
    period_id: 0,
    access_token: token,
    url: apiBase,
    offset: config.pageSize,
    offsetID,
    flag: true,
    type: '',
    start_hr: null,
    end_hr: null,
    asset_id: null,
    applyDate: false,
    filterData: {
      date: null, access_token: null, url: null, last_date: null, offset: null, flag: true,
      out_type: -1, salesman_id: 0, policyID: 0, outlet_type: 0, travel_type_id: 0,
      class_type: null, program_type: 0, status: null, max_claim: false, trax_outlet: false,
      non_trax_outlet: false, exclude_trax_audit: false, region_id: 0, cluster_id: 0,
      team_id: 0, territory_id: 0, dc_id: 0, displayData: [], payment_mode: '', active: true,
      inf_type_ids: [],
    },
    customFilter: {},
    searchableFilter: null,
  };
}

async function fetchPage(params) {
  const { status, json, text } = await postJson(params.apiBase + config.reportPath, buildPayload(params), { authorization: params.token });
  if (status === 401 || status === 403) throw new UpstreamError('SalesDiary rejected the token (expired or invalid).', 401, 'token');
  if (status >= 400) throw new UpstreamError(`SalesDiary responded ${status}: ${String(text).slice(0, 200)}`, 502);
  if (!json) throw new UpstreamError('SalesDiary returned a non-JSON response.', 502);
  const results = json.results || json;
  if (results.status && Number(results.status) !== 200) {
    const msg = results.msg || 'unknown error';
    const authLike = Number(results.status) === 401 || /token|auth|expire|login|session/i.test(msg);
    throw new UpstreamError(`SalesDiary: ${msg}`, authLike ? 401 : 502, authLike ? 'token' : undefined);
  }
  return { rows: Array.isArray(results.data) ? results.data : [], time: results.time || null };
}

// Pulls every page for the range. Rows are de-duplicated by id, so a wrong paging guess
// stops cleanly instead of looping.
async function fetchReport(start, end, { token, apiBase }) {
  if (!token) throw new UpstreamError('Not signed in to SalesDiary.', 401, 'token');
  const seen = new Set();
  const rows = [];
  let offsetID = 0;
  let pages = 0;
  let upstreamTime = null;
  let total = null;

  while (pages < config.maxPages) {
    const page = await fetchPage({ start, end, offsetID, token, apiBase });
    pages++;
    upstreamTime = page.time || upstreamTime;
    let added = 0;
    for (const row of page.rows) {
      const key = row.id ?? `${row.session_id}-${row.product_id}-${row.retailer_id}-${row.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      added++;
    }
    if (page.rows.length && page.rows[0].total_prog != null) total = Number(page.rows[0].total_prog);

    const done =
      config.pagination === 'none' ||
      added === 0 ||
      page.rows.length < config.pageSize ||
      (total != null && rows.length >= total);
    if (done) break;

    offsetID = config.pagination === 'offset'
      ? rows.length
      : page.rows.reduce((max, r) => (Number(r.id) > max ? Number(r.id) : max), offsetID);
  }

  return { rows, pages, upstreamTime, total };
}

module.exports = { findCompany, login, fetchReport, decodeToken, UpstreamError, JWT_RE };
