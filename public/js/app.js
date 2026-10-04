import { PAGES } from './reports.js';
import { FilterBar, DateRange, makeFilterState, applyFilters, presets } from './filters.js';
import * as C from './charts.js';
import * as A from './analytics.js';
import { ago, num, esc, rangeLabel } from './format.js';
import { toast } from './ui.js';
import { initAuth, logoHtml } from './auth.js';
import { connect, hasSnapshot } from './backend.js';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sw-' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sw-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  backend: null,
  status: null,
  range: store.get('range', { preset: 'mtd', start: '', end: '' }),
  interval: store.get('interval', 5),
  filters: makeFilterState(),
  all: [],
  meta: { columns: [] },
  lastOk: 0,
  loading: false,
  error: null,
  page: 'overview',
  mounted: new Map(), // page -> { el }
  schema: '',
  freshSessions: new Set(),
  timer: null,
  authed: false,
};

const $ = (id) => document.getElementById(id);
const content = $('content');
const isSnapshot = () => state.backend?.kind === 'snapshot';

// ---------------------------------------------------------------- data

async function load({ reset = false } = {}) {
  if (state.loading || !state.backend) return;
  state.loading = true;
  clearTimeout(state.timer);
  $('refreshBtn').classList.add('spin');
  if (reset) {
    state.backend.resetCache();
    showLoading();
  }
  try {
    const res = await state.backend.report(state.range.start, state.range.end);
    state.error = null;
    state.lastOk = Date.now();
    if (res.changed) ingest(res, reset);
    if ($('banner').classList.contains('err')) $('banner').hidden = true;
  } catch (err) {
    state.error = err;
    if (err.status === 401 && (err.code === 'login_required' || err.code === 'token')) {
      signedOut(err.code === 'token' ? 'Your SalesDiary session expired. Please sign in again.' : '');
      return;
    }
    if (err.code === 'offline' && !state.all.length) {
      offline(err.message);
      return;
    }
    showError(err);
    if (!state.all.length) renderEmpty(err);
  } finally {
    state.loading = false;
    $('refreshBtn').classList.remove('spin');
    updateLive();
    updateFooter();
    schedule();
  }
}

function ingest(res, reset) {
  const { rows } = res;
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
  state.meta = { ...res.meta, columns: res.columns };
  if (isSnapshot()) {
    state.range = { preset: null, start: res.meta.start, end: res.meta.end };
    $('dateLabel').textContent = `Snapshot · ${rangeLabel(res.meta.start, res.meta.end)}`;
  }

  // Colours follow entities across filters, seeded from the full dataset.
  for (const dim of ['brand', 'outlet_type', 'region', 'category']) {
    C.seedSlots(dim, A.sortBy(A.groupBy(rows, dim), 'checks').map((g) => g.key));
  }

  const schema = res.columns.join('|');
  if (schema !== state.schema) {
    state.schema = schema;
    filterBar.build(res.columns);
    for (const m of state.mounted.values()) m.el.remove();
    state.mounted.clear();
  }
  if (newRows) toast(`${num(newRows)} new SKU check${newRows === 1 ? '' : 's'} · ${num(fresh.size)} visit${fresh.size === 1 ? '' : 's'} updated`);
  render();
}

// ---------------------------------------------------------------- live polling

function schedule() {
  clearTimeout(state.timer);
  const tick = $('tick');
  tick.classList.remove('run');
  tick.style.width = '0';
  const secs = isSnapshot() ? Math.max(60, state.interval) : state.interval;
  if (!state.interval || document.hidden || !state.authed) return;
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
  else if (!state.lastOk) text.textContent = 'Connecting';
  else text.textContent = state.interval ? ago(state.lastOk) : 'Paused';
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

function eyebrow(rows) {
  const who = state.status?.company?.name || (isSnapshot() ? 'Published snapshot' : state.status?.mode === 'mock' ? 'Demo data' : 'SalesDiary');
  const range = state.range.start ? rangeLabel(state.range.start, state.range.end) : '';
  const count = rows.length === state.all.length ? `${num(rows.length)} records` : `${num(rows.length)} of ${num(state.all.length)} records`;
  return [who, range, count].filter(Boolean).map(esc).join('<span class="sep">/</span>');
}

function render() {
  const page = PAGES[state.page];
  $('pageTitle').textContent = page.title;
  document.title = `${page.title} · Shelfwise`;
  if (!state.meta.columns.length) return;
  $('loading')?.remove();
  const rows = filtered();
  const ctx = context(rows);
  $('pageEyebrow').innerHTML = eyebrow(rows);
  $('pageSub').innerHTML = rows.length && page.summary ? page.summary(ctx) : esc(page.sub);

  let m = state.mounted.get(state.page);
  if (!m) {
    const el = document.createElement('div');
    el.className = 'page';
    content.appendChild(el);
    page.mount(el, ctx);
    m = { el };
    state.mounted.set(state.page, m);
  }
  for (const [k, other] of state.mounted) other.el.hidden = k !== state.page;
  content.querySelector('.empty-state')?.remove();

  if (!rows.length) {
    m.el.hidden = true;
    content.insertAdjacentHTML('beforeend', `<div class="empty-state"><h3>Nothing matches this selection</h3>${state.all.length ? 'Loosen a filter or clear the search.' : 'SalesDiary returned no records for these dates.'}</div>`);
    return;
  }
  page.update(m.el, ctx);
}

function showLoading() {
  if ($('loading')) return;
  for (const m of state.mounted.values()) m.el.hidden = true;
  content.insertAdjacentHTML('afterbegin', `<div class="loading" id="loading"><div class="skeleton-row"><span></span><span></span><span></span><span></span></div><div class="skeleton-block"></div></div>`);
}

function renderEmpty(err) {
  $('loading')?.remove();
  content.querySelector('.empty-state')?.remove();
  content.insertAdjacentHTML('beforeend', `<div class="empty-state"><h3>Couldn’t load the report</h3>${esc(err.message)}</div>`);
}

function updateFooter() {
  const m = state.meta;
  const parts = [];
  if (state.backend?.kind === 'server') parts.push(`Server ${esc(state.backend.base.replace(/^https?:\/\//, ''))}`);
  if (isSnapshot()) parts.push('Published snapshot');
  if (m.fetchedAt) parts.push(`Updated ${new Date(m.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
  if (m.rows != null) parts.push(`${num(m.rows)} rows${m.pages > 1 ? ` in ${m.pages} pages` : ''}`);
  $('footStatus').innerHTML = parts.join(' · ');
}

// ---------------------------------------------------------------- banner / status / account

const WARN_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>';

function showError(err) {
  const b = $('banner');
  b.className = 'banner err';
  b.innerHTML = `${WARN_ICON}<span class="grow">${esc(err.message)}${state.lastOk ? ` Showing data from ${ago(state.lastOk)}.` : ''}</span>`;
  b.hidden = false;
}

async function refreshStatus() {
  let s = null;
  try {
    s = await state.backend.status();
  } catch {
    $('sourceDot').className = 'dot err';
    $('sourceTitle').textContent = 'Offline';
    return null;
  }
  state.status = s;
  const demo = s.source === 'mock' || s.source === 'snapshot';
  $('sourceDot').className = 'dot ' + (state.error ? 'err' : demo ? 'demo' : 'ok');
  if (s.user) {
    $('sourceTitle').innerHTML = `<span class="avatar">${logoHtml({ ...s.company, key: s.company?.key })}</span>${esc(s.user.name || s.user.username)}`;
  } else {
    $('sourceTitle').textContent = s.source === 'snapshot' ? 'Snapshot' : demo ? 'Demo' : 'Shared';
  }
  $('brandSub').textContent = s.company?.name || '';
  $('brandSub').hidden = !s.company?.name;
  $('dateBtn').disabled = !state.backend.canChangeRange;

  const b = $('banner');
  if (demo && (b.hidden || b.classList.contains('info'))) {
    b.className = 'banner info';
    b.innerHTML = `${WARN_ICON}<span class="grow">${s.source === 'snapshot' ? 'This is the snapshot published with the website, not live data.' : 'You’re looking at generated demo data, not your SalesDiary numbers.'}</span>${s.requireLogin || s.source === 'snapshot' ? '<button class="btn btn-sm" data-signin type="button">Sign in for live data</button>' : ''}`;
    b.hidden = false;
    b.querySelector('[data-signin]')?.addEventListener('click', signOut);
  } else if (!demo && b.classList.contains('info')) b.hidden = true;
  return s;
}

function openSettings() {
  const s = state.status || {};
  const exp = s.token?.exp ? new Date(s.token.exp).toLocaleString() : '—';
  const m = state.meta;
  const fetched = m.fetchedAt ? `${new Date(m.fetchedAt).toLocaleTimeString()} · ${num(m.rows)} rows · ${m.pages || 1} page(s) · ${m.durationMs ?? '—'} ms` : '—';
  $('connInfo').innerHTML = isSnapshot()
    ? `<dt>Mode</dt><dd>Snapshot published with the website</dd><dt>Generated</dt><dd>${esc(m.fetchedAt ? new Date(m.fetchedAt).toLocaleString() : '—')}</dd><dt>Rows</dt><dd>${num(state.all.length)}</dd>`
    : `<dt>Signed in as</dt><dd>${esc(s.user ? `${s.user.name || ''} (${s.user.username})` : s.mode === 'mock' ? 'Demo session' : s.mode === 'shared' ? 'Shared server token' : '—')}</dd>
       <dt>Company</dt><dd>${esc(s.company ? `${s.company.name} · ${s.company.instance || s.company.key}` : '—')}</dd>
       <dt>Data server</dt><dd>${esc(state.backend.base)}</dd>
       <dt>SalesDiary API</dt><dd>${esc(s.apiBase || '—')}</dd>
       <dt>Profile</dt><dd>${esc(s.token?.profile || '—')}</dd>
       <dt>Token expiry</dt><dd>${esc(exp)}${s.token?.expired ? ' (expired)' : ''}${s.autoRenew ? ' · renews automatically' : ''}</dd>
       <dt>Last fetch</dt><dd>${fetched}</dd>`;
  $('signOut').hidden = s.mode === 'shared';
  $('signOut').textContent = s.user ? 'Sign out' : 'Sign in with SalesDiary';
  $('tokenSection').hidden = isSnapshot() || s.allowTokenUpdate === false || s.mode !== 'live';
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
    await state.backend.loginToken(token);
    $('tokenMsg').textContent = 'Token replaced';
    $('tokenInput').value = '';
    await refreshStatus();
    load({ reset: true });
    setTimeout(closeSettings, 900);
  } catch (e) {
    $('tokenMsg').textContent = e.message;
  }
}

// ---------------------------------------------------------------- connect / sign in / out

function resetData() {
  clearTimeout(state.timer);
  state.all = [];
  state.meta = { columns: [] };
  state.lastOk = 0;
  state.error = null;
  state.schema = '';
  for (const m of state.mounted.values()) m.el.remove();
  state.mounted.clear();
  C.resetTheme();
  content.querySelector('.empty-state')?.remove();
  $('banner').hidden = true;
  showLoading();
}

async function offline(message) {
  state.authed = false;
  resetData();
  closeSettings();
  const url = state.backend?.kind === 'server' ? state.backend.base : (await connect()).url;
  auth.showOffline(url || 'http://localhost:8080', await hasSnapshot(), message);
}

function signedOut(message) {
  state.authed = false;
  resetData();
  closeSettings();
  auth.show(state.status, message);
}

async function signOut() {
  if (isSnapshot()) {
    const conn = await connect();
    if (conn.offline) return offline();
    state.backend = conn.backend;
    state.status = await state.backend.status().catch(() => null);
    return signedOut();
  }
  await state.backend.logout();
  const s = await refreshStatus();
  if (s?.authenticated) {
    // This server doesn't require a login: it falls back to shared/demo data.
    state.authed = true;
    closeSettings();
    load({ reset: true });
  } else signedOut();
}

async function signedIn() {
  auth.hide();
  state.authed = true;
  resetData();
  await refreshStatus();
  dateRange.label();
  go(location.hash.slice(1) || 'overview');
  load({ reset: true });
}

async function start(conn) {
  if (conn.offline) {
    auth.showOffline(conn.url, await hasSnapshot());
    return false;
  }
  state.backend = conn.backend;
  const s = await state.backend.status().catch(() => null);
  state.status = s;
  if (!s) {
    auth.showOffline(state.backend.base, await hasSnapshot());
    return false;
  }
  if (!s.authenticated) {
    auth.show(s);
    return true;
  }
  await signedIn();
  return true;
}

const auth = initAuth({
  getBackend: () => state.backend,
  onSignedIn: signedIn,
  async onRetry(url) {
    const conn = await connect({ forceUrl: url });
    if (conn.offline) return false;
    await start(conn);
    return true;
  },
  async onSnapshot() {
    await start(await connect({ snapshot: true }));
  },
});

// ---------------------------------------------------------------- navigation, theme

function go(page) {
  if (!PAGES[page]) page = 'overview';
  state.page = page;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  document.querySelector('#nav a.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
$('sourceCard').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
$('drawerBackdrop').addEventListener('click', closeSettings);
$('saveToken').addEventListener('click', () => {
  const v = $('tokenInput').value.trim();
  if (v) saveToken(v);
  else $('tokenMsg').textContent = 'Paste a token first.';
});
$('signOut').addEventListener('click', signOut);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) {
    C.resetTheme();
    render();
  }
});

(async function boot() {
  if (!state.range.preset && (!state.range.start || !state.range.end)) {
    const p = presets().find((x) => x.id === 'mtd');
    Object.assign(state.range, { preset: 'mtd', start: p.start, end: p.end });
  }
  dateRange.range = state.range;
  dateRange.label();
  go(location.hash.slice(1) || 'overview');
  await start(await connect());
})();
