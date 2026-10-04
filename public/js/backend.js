// The UI is a static site (GitHub Pages). All data comes from the Shelfwise server running in
// Docker on the user's machine (default http://localhost:8080). When the UI is opened from the
// server itself (local dev) the same origin is used.

const DEFAULT_SERVER = 'http://localhost:8080';
const store = {
  get(k) {
    try {
      return localStorage.getItem('sw-' + k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem('sw-' + k);
      else localStorage.setItem('sw-' + k, v);
    } catch {
      /* private mode */
    }
  },
};

function fail(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

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

const normalize = (url) => String(url || '').trim().replace(/\/+$/, '');

async function probe(base, timeoutMs = 3500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base ? base + '/' : ''}api/status`, { cache: 'no-store', signal: controller.signal, credentials: base ? 'omit' : 'same-origin' });
    return res.ok && (res.headers.get('content-type') || '').includes('json');
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** base = '' for same origin, or e.g. 'http://localhost:8080'. */
function serverBackend(base) {
  const prefix = base ? base + '/' : '';
  const sessionKey = 'session:' + (base || location.origin);
  let session = store.get(sessionKey);
  let etag = null;

  const headers = (extra = {}) => ({ ...(session ? { 'X-Session': session } : {}), ...extra });
  const call = async (path, opts = {}) => {
    let res;
    try {
      res = await fetch(prefix + path, { cache: 'no-store', credentials: base ? 'omit' : 'same-origin', ...opts, headers: headers(opts.headers) });
    } catch {
      throw fail(`Can't reach the Shelfwise server at ${base || location.origin}. Is Docker running?`, { status: 0, code: 'offline' });
    }
    return res;
  };
  const post = async (path, body) => {
    const res = await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const json = await readJson(res);
    if (!res.ok) throw fail(json.error || `Request failed (${res.status})`, { status: res.status });
    if (json.session) {
      session = json.session;
      store.set(sessionKey, session);
    }
    return json;
  };

  return {
    kind: 'server',
    base: base || location.origin,
    remote: Boolean(base),
    canChangeRange: true,
    async status() {
      const res = await call('api/status');
      if (!res.ok) throw fail('Server unreachable', { code: 'offline' });
      return res.json();
    },
    loginToken: (token) => post('api/auth/token', { token }),
    demo: () => post('api/auth/demo'),
    async logout() {
      await post('api/auth/logout').catch(() => {});
      session = null;
      store.set(sessionKey, null);
    },
    resetCache() {
      etag = null;
    },
    async report(start, end) {
      const res = await call(`api/report?start=${start}&end=${end}`, { headers: etag ? { 'If-None-Match': etag } : {} });
      if (res.status === 304) return { changed: false };
      const json = await readJson(res);
      if (!res.ok) throw fail(json.error || `Request failed (${res.status})`, { status: res.status, code: json.code });
      etag = res.headers.get('ETag');
      return { changed: true, meta: json.meta, columns: json.columns, rows: decode(json) };
    },
  };
}

/** Read-only view of data/report.json published with the site (demo data unless opted in). */
function snapshotBackend() {
  let stamp = null;
  return {
    kind: 'snapshot',
    canChangeRange: false,
    async status() {
      return { requireLogin: false, authenticated: true, source: 'snapshot', mode: 'snapshot' };
    },
    resetCache() {
      stamp = null;
    },
    async logout() {},
    async report() {
      const res = await fetch(`data/report.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw fail('No snapshot has been published with this site.', { status: res.status });
      const json = await res.json();
      if (json.meta.fetchedAt === stamp) return { changed: false };
      stamp = json.meta.fetchedAt;
      return { changed: true, meta: json.meta, columns: json.columns, rows: decode(json) };
    },
  };
}

async function siteConfig() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch {
    /* none */
  }
  return {};
}

export function getServerUrl(cfg = {}) {
  return normalize(store.get('server') || cfg.serverUrl || DEFAULT_SERVER);
}

export function setServerUrl(url) {
  store.set('server', normalize(url) || null);
}

export async function hasSnapshot() {
  try {
    const r = await fetch('data/report.json', { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Same origin first (UI served by the server), then the configured local server.
 * Returns { backend } or { offline: true, url }.
 */
/** A shared link like ?server=https://abc.trycloudflare.com points this browser at that server. */
function serverFromLink() {
  try {
    const params = new URLSearchParams(location.search);
    const url = normalize(params.get('server'));
    if (!url || !/^https?:\/\//i.test(url)) return null;
    params.delete('server');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    return url;
  } catch {
    return null;
  }
}

export async function connect({ forceUrl, snapshot } = {}) {
  if (snapshot) return { backend: snapshotBackend() };
  const linked = serverFromLink();
  if (linked) {
    setServerUrl(linked);
    forceUrl = linked;
  }
  if (!forceUrl && (await probe(''))) return { backend: serverBackend('') };
  const url = normalize(forceUrl) || getServerUrl(await siteConfig());
  if (await probe(url)) {
    setServerUrl(url);
    return { backend: serverBackend(url) };
  }
  return { offline: true, url };
}
