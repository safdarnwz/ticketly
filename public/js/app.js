import { PAGES } from './reports.js';
import { FilterBar, DateRange, makeFilterState, applyFilters, presets } from './filters.js';
import * as C from './charts.js';
import * as A from './analytics.js';
import { ago, num, esc, rangeLabel } from './format.js';
import { toast } from './ui.js';
import { initAuth, logoHtml } from './auth.js';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sw-' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sw-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  mode: 'server', // 'server' = Node API, 'static' = snapshot JSON (GitHub Pages)
  range: store.get('range', { preset: 'mtd', start: '', end: '' }),
  interval: store.get('interval', 5),
  filters: makeFilterState(),
  all: [],
  meta: { columns: [] },
  etag: null,
  lastOk: 0,
  loading: false,
  error: null,
  page: 'overview',
  mounted: new Map(), // page -> { el, version }
  version: 0,
  schema: '',
  freshSessions: new Set(),
  timer: null,
  authed: false,
};

const $ = (id) => document.getElementById(id);
const content = $('content');

// ---------------------------------------------------------------- data

function decode(payload) {
  const cols = payload.columns;
  const rows = new Array(payload.rows.length);
  for (let i = 0; i < payload.rows.length; i++) {
    const src = payload.rows[i];
    const o = {};
    for (let j = 0; j < cols.length; j++) o[cols[j]] = src[j];
    rows[i] = o;
  }
  return rows;
}

async function fetchData() {
  if (state.mode === 'static') {
    const res = await fetch(`data/report.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw Object.assign(new Error('Snapshot not found (data/report.json).'), { status: res.status });
    const json = await res.json();
    return { changed: json.meta.fetchedAt !== state.meta.fetchedAt, json };
  }
  const { start, end } = state.range;
  const headers = state.etag ? { 'If-None-Match': state.etag } : {};
  const res = await fetch(`api/report?start=${start}&end=${end}`, { headers, cache: 'no-cache' });
  if (res.status === 304) return { changed: false };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, code: json.code });
  state.etag = res.headers.get('ETag');
  return { changed: true, json };
}

async function load({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  clearTimeout(state.timer);
  $('refreshBtn').classList.add('spin');
  if (reset) {
    state.etag = null;
    showLoading();
  }
  try {
    const { changed, json } = await fetchData();
    state.error = null;
    state.lastOk = Date.now();
    if (changed) ingest(json, reset);
    hideBanner();
  } catch (err) {
    state.error = err;
    if (state.mode === 'server' && err.status === 401 && (err.code === 'login_required' || err.code === 'token')) {
      signedOut(err.code === 'token' ? 'Your SalesDiary session expired. Please sign in again.' : '');
      return;
    }
    showError(err);
    if (!state.all.length) renderEmpty(err);
  } finally {
    state.loading = false;
    $('refreshBtn').classList.remove('spin');
    updateLive();
    schedule();
  }
}

function ingest(json, reset) {
  const rows = decode(json);
  const prevIds = reset || !state.all.length ? null : new Set(state.all.map((r) => r.id));
  const fresh = new Set();
  let newRows = 0;
  if (prevIds) {
    for (const r of rows) {
      if (!prevIds.has(r.id)) {
        newRows++;
        fresh.add(r.session_id);
      }
    }
  }
  state.freshSessions = fresh;
  state.all = rows;
  state.meta = { ...json.meta, columns: json.columns };
  if (state.mode === 'static') {
    state.range = { preset: null, start: json.meta.start, end: json.meta.end };
    $('dateLabel').textContent = `Snapshot · ${rangeLabel(json.meta.start, json.meta.end)}`;
  }

  // Colours follow entities across filters, seeded from the full dataset.
  for (const dim of ['brand', 'outlet_type', 'region', 'category']) {
    C.seedSlots(dim, A.sortBy(A.groupBy(rows, dim), 'checks').map((g) => g.key));
  }

  const schema = json.columns.join('|');
  if (schema !== state.schema) {
    state.schema = schema;
    filterBar.build(json.columns);
    for (const m of state.mounted.values()) m.el.remove();
    state.mounted.clear();
  }
  if (newRows) toast(`${num(newRows)} new SKU check${newRows === 1 ? '' : 's'} · ${num(fresh.size)} visit${fresh.size === 1 ? '' : 's'} updated`);
  state.version++;
  render();
}

// ---------------------------------------------------------------- live polling

function schedule() {
  clearTimeout(state.timer);
  const tick = $('tick');
  tick.classList.remove('run');
  tick.style.width = '0';
  const secs = state.mode === 'static' ? Math.max(60, state.interval) : state.interval;
  if (!state.interval || document.hidden || !state.authed) return;
  // Restart the progress line so it runs for exactly one interval.
  requestAnimationFrame(() => {
    tick.classList.add('run');
    tick.style.transitionDuration = `${secs}s`;
    tick.style.width = '100%';
  });
  state.timer = setTimeout(() => load(), secs * 1000);
}

function updateLive() {
  const dot = $('liveDot');
  const text = $('liveText');
  dot.className = 'live-dot' + (state.error ? ' err' : state.interval ? ' on' : '');
  if (state.error && !state.lastOk) text.textContent = 'Offline';
  else if (!state.lastOk) text.textContent = 'Connecting…';
  else text.textContent = `${state.interval ? 'Live' : 'Paused'} · ${ago(state.lastOk)}`;
}
setInterval(updateLive, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(state.timer);
  else if (state.interval && state.authed) load();
});

// ---------------------------------------------------------------- rendering

const filtered = () => applyFilters(state.all, state.filters);

function context(rows) {
  return {
    rows,
    all: state.all,
    meta: state.meta,
    freshSessions: state.freshSessions,
    filter: (dim, value) => filterBar.toggle(dim, value),
    search: (q) => {
      $('globalSearch').value = q;
      state.filters.search = q;
      filterBar.changed();
    },
    current: () => context(filtered()),
  };
}

function render() {
  if (!state.all.length && !state.meta.columns.length) return;
  $('loading')?.remove();
  const page = PAGES[state.page];
  $('pageTitle').textContent = page.title;
  const rows = filtered();
  const ctx = context(rows);
  const selected = rows.length === state.all.length ? `${num(rows.length)} rows` : `${num(rows.length)} of ${num(state.all.length)} rows`;
  $('pageSub').textContent = `${page.sub} · ${selected}`;

  let m = state.mounted.get(state.page);
  if (!m) {
    const el = document.createElement('div');
    el.className = 'page';
    el.style.display = 'contents';
    content.appendChild(el);
    page.mount(el, ctx);
    m = { el, version: -1 };
    state.mounted.set(state.page, m);
  }
  for (const [k, other] of state.mounted) other.el.hidden = k !== state.page;
  content.querySelector('.empty-state')?.remove();

  if (!rows.length) {
    m.el.hidden = true;
    content.insertAdjacentHTML('beforeend', `<div class="empty-state"><h3>No rows for this selection</h3>${state.all.length ? 'Loosen a filter or clear the search.' : 'The API returned no data for this date range.'}</div>`);
    return;
  }
  page.update(m.el, ctx);
  m.version = state.version;
}

function showLoading() {
  if ($('loading')) return;
  for (const m of state.mounted.values()) m.el.hidden = true;
  content.insertAdjacentHTML('afterbegin', `<div class="loading" id="loading"><div class="skeleton-row"><span></span><span></span><span></span><span></span></div><div class="skeleton-block"></div></div>`);
}

function renderEmpty(err) {
  $('loading')?.remove();
  content.querySelector('.empty-state')?.remove();
  content.insertAdjacentHTML('beforeend', `<div class="empty-state"><h3>Couldn’t load data</h3>${esc(err.message)}</div>`);
}

// ---------------------------------------------------------------- banner / status / settings

const WARN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>';

function showError(err) {
  const b = $('banner');
  const auth = err.status === 401;
  b.className = 'banner err';
  b.innerHTML = `${WARN_ICON}<span class="grow">${esc(err.message)}${state.lastOk ? ` Showing data from ${ago(state.lastOk)}.` : ''}</span>${auth && state.mode === 'server' ? '<button class="btn btn-sm" data-open-settings type="button">Account</button>' : ''}`;
  b.hidden = false;
  b.querySelector('[data-open-settings]')?.addEventListener('click', openSettings);
}

function hideBanner() {
  const b = $('banner');
  if (b.classList.contains('err')) b.hidden = true;
  refreshStatus();
}

let lastStatus = null;
async function refreshStatus() {
  const dot = $('sourceDot');
  if (state.mode === 'static') {
    const demo = state.meta.source === 'mock';
    dot.className = 'dot ' + (demo ? 'demo' : 'ok');
    $('sourceTitle').textContent = demo ? 'Snapshot · demo data' : 'Published snapshot';
    $('sourceSub').textContent = state.meta.fetchedAt ? `Generated ${new Date(state.meta.fetchedAt).toLocaleString()}` : '';
    return;
  }
  try {
    const s = await (await fetch('api/status', { cache: 'no-store' })).json();
    lastStatus = s;
    const demo = s.source === 'mock';
    dot.className = 'dot ' + (state.error ? 'err' : demo ? 'demo' : 'ok');
    const exp = s.token?.exp ? new Date(s.token.exp) : null;
    if (s.user) {
      $('sourceTitle').innerHTML = `<span class="user-line"><span class="avatar">${logoHtml({ ...s.company, key: s.company?.key })}</span>${esc(s.user.name || s.user.username)}</span>`;
      $('sourceSub').textContent = `${s.company?.name || s.company?.key || ''}${s.autoRenew ? ' · auto-renew on' : exp ? ` · token till ${exp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;
    } else {
      $('sourceTitle').textContent = demo ? 'Demo data' : 'SalesDiary · live';
      $('sourceSub').textContent = demo ? (s.requireLogin ? 'Sign in for live numbers' : 'Demo mode') : exp ? `Token valid till ${exp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : s.apiBase || '';
    }
    $('brandSub').textContent = s.company?.name || s.token?.instance || 'Stock availability';
    $('brandSub').title = $('brandSub').textContent;
    const b = $('banner');
    if (demo && (b.hidden || b.classList.contains('info'))) {
      b.className = 'banner info';
      b.innerHTML = `${WARN_ICON}<span class="grow">You’re exploring generated demo data, not your SalesDiary numbers.</span>${s.requireLogin ? '<button class="btn btn-sm" data-signin type="button">Sign in</button>' : ''}`;
      b.hidden = false;
      b.querySelector('[data-open-settings]')?.addEventListener('click', openSettings);
      b.querySelector('[data-signin]')?.addEventListener('click', signOut);
    } else if (!demo && b.classList.contains('info')) b.hidden = true;
    return s;
  } catch {
    dot.className = 'dot err';
    $('sourceTitle').textContent = 'Server unreachable';
    return null;
  }
}

function openSettings() {
  const s = lastStatus || {};
  const exp = s.token?.exp ? new Date(s.token.exp).toLocaleString() : '—';
  const fetched = state.meta.fetchedAt ? `${new Date(state.meta.fetchedAt).toLocaleTimeString()} · ${num(state.meta.rows)} rows · ${state.meta.pages} page(s) · ${state.meta.durationMs} ms` : '—';
  $('connInfo').innerHTML = state.mode === 'static'
    ? `<dt>Mode</dt><dd>Static snapshot (GitHub Pages)</dd><dt>Generated</dt><dd>${esc(state.meta.fetchedAt || '—')}</dd><dt>Rows</dt><dd>${num(state.all.length)}</dd>`
    : `<dt>Signed in as</dt><dd>${esc(s.user ? `${s.user.name || ''} (${s.user.username})` : s.mode === 'mock' ? 'Demo session' : s.mode === 'shared' ? 'Shared server token' : '—')}</dd>
       <dt>Company</dt><dd>${esc(s.company ? `${s.company.name} · ${s.company.instance || s.company.key}` : '—')}</dd>
       <dt>Endpoint</dt><dd>${esc(s.apiBase || '—')}</dd>
       <dt>Profile</dt><dd>${esc(s.token?.profile || '—')}</dd>
       <dt>Token expiry</dt><dd>${esc(exp)}${s.token?.expired ? ' (expired)' : ''}${s.autoRenew ? ' · renews automatically' : ''}</dd>
       <dt>Last fetch</dt><dd>${fetched}</dd>`;
  $('signOut').hidden = state.mode === 'static' || s.mode === 'shared';
  $('signOut').textContent = s.mode === 'mock' && s.requireLogin ? 'Leave demo & sign in' : 'Sign out';
  $('tokenSection').hidden = state.mode === 'static' || s.allowTokenUpdate === false || s.mode !== 'live';
  $('tokenMsg').textContent = '';
  $('settingsDrawer').hidden = false;
  $('drawerBackdrop').hidden = false;
}

function closeSettings() {
  $('settingsDrawer').hidden = true;
  $('drawerBackdrop').hidden = true;
}

async function saveToken(token) {
  $('tokenMsg').textContent = 'Saving…';
  try {
    const res = await fetch('api/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed');
    $('tokenMsg').textContent = 'Token replaced';
    $('tokenInput').value = '';
    await refreshStatus();
    load({ reset: true });
    setTimeout(closeSettings, 900);
  } catch (e) {
    $('tokenMsg').textContent = e.message;
  }
}

// ---------------------------------------------------------------- sign in / out

function resetData() {
  clearTimeout(state.timer);
  state.all = [];
  state.meta = { columns: [] };
  state.etag = null;
  state.lastOk = 0;
  state.error = null;
  state.schema = '';
  for (const m of state.mounted.values()) m.el.remove();
  state.mounted.clear();
  C.resetTheme();
  content.querySelector('.empty-state')?.remove();
  showLoading();
}

function signedOut(message) {
  state.authed = false;
  resetData();
  closeSettings();
  auth.show(lastStatus, message);
}

async function signOut() {
  await auth.signOut();
  lastStatus = await refreshStatus();
  if (lastStatus?.authenticated) {
    // Login not required on this server: falling back to shared/demo data.
    state.authed = true;
    closeSettings();
    load({ reset: true });
  } else signedOut();
}

async function signedIn() {
  auth.hide();
  state.authed = true;
  $('banner').hidden = true;
  resetData();
  lastStatus = await refreshStatus();
  go(location.hash.slice(1) || 'overview');
  load({ reset: true });
}

const auth = initAuth({ onSignedIn: signedIn });

// ---------------------------------------------------------------- navigation, theme

function go(page) {
  if (!PAGES[page]) page = 'overview';
  state.page = page;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('sidebar').classList.remove('open');
  render();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => go(location.hash.slice(1)));

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('sw-theme', root.dataset.theme); } catch { /* ignore */ }
  C.resetTheme();
  render();
}

// ---------------------------------------------------------------- boot

const filterBar = new FilterBar({ state: state.filters, getRows: () => state.all, onChange: () => render() });

const dateRange = new DateRange({
  range: state.range,
  onChange: (range) => {
    state.range = range;
    store.set('range', { preset: range.preset, start: range.start, end: range.end });
    load({ reset: true });
  },
});

$('intervalSelect').value = String(state.interval);
$('intervalSelect').addEventListener('change', (e) => {
  state.interval = Number(e.target.value);
  store.set('interval', state.interval);
  updateLive();
  if (state.interval) load();
  else schedule();
});
$('refreshBtn').addEventListener('click', () => load());
$('themeBtn').addEventListener('click', toggleTheme);
$('settingsBtn').addEventListener('click', openSettings);
$('sourceCard').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
$('drawerBackdrop').addEventListener('click', closeSettings);
$('saveToken').addEventListener('click', () => {
  const v = $('tokenInput').value.trim();
  if (v) saveToken(v);
  else $('tokenMsg').textContent = 'Paste a token first.';
});
$('signOut').addEventListener('click', signOut);
$('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) {
    C.resetTheme();
    render();
  }
});

(async function boot() {
  // No Node server behind us (e.g. GitHub Pages) -> read the published snapshot instead.
  let status = null;
  try {
    const r = await fetch('api/status', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
    status = await r.json();
  } catch {
    state.mode = 'static';
    $('dateBtn').disabled = true;
    $('settingsBtn').hidden = true;
  }
  if (!state.range.preset && (!state.range.start || !state.range.end)) {
    const p = presets().find((x) => x.id === 'mtd');
    Object.assign(state.range, { preset: 'mtd', start: p.start, end: p.end });
  }
  dateRange.range = state.range;
  dateRange.label();
  go(location.hash.slice(1) || 'overview');
  if (state.mode === 'server' && !status.authenticated) {
    lastStatus = status;
    auth.show(status);
    return;
  }
  state.authed = true;
  lastStatus = await refreshStatus();
  load({ reset: true });
})();
