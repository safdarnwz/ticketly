// All metrics are derived from one row = one SKU checked at one outlet visit.
//   availability %   = checks where the SKU was on shelf / all checks
//   visit            = one session_id (a rep at an outlet on a day)
//   productive visit = a visit with at least one ordered line
//   strike rate      = productive visits / visits

export const DIMENSIONS = [
  { key: 'region', label: 'Region', primary: true },
  { key: 'cluster', label: 'Cluster' },
  { key: 'territory', label: 'Territory' },
  { key: 'pteam', label: 'RSM team' },
  { key: 'team', label: 'Team', primary: true },
  { key: 'salesman', label: 'Salesman', primary: true },
  { key: 'outlet_type', label: 'Outlet type', primary: true },
  { key: 'class', label: 'Class' },
  { key: 'brand', label: 'Brand', primary: true },
  { key: 'category', label: 'Category', primary: true },
  { key: 'product', label: 'Product' },
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'o_name', label: 'Outlet' },
  { key: 'date', label: 'Date' },
];

export const METRICS = [
  { key: 'availPct', label: 'Availability %', fmt: 'pct' },
  { key: 'checks', label: 'SKU checks', fmt: 'num' },
  { key: 'available', label: 'In-stock checks', fmt: 'num' },
  { key: 'oos', label: 'Out-of-stock checks', fmt: 'num' },
  { key: 'visits', label: 'Visits', fmt: 'num' },
  { key: 'outlets', label: 'Outlets', fmt: 'num' },
  { key: 'orderQty', label: 'Order qty', fmt: 'num' },
  { key: 'orderLines', label: 'Order lines', fmt: 'num' },
  { key: 'strikeRate', label: 'Strike rate %', fmt: 'pct' },
  { key: 'skusPerVisit', label: 'SKUs in stock / visit', fmt: 'dec' },
  { key: 'sosAvg', label: 'Avg SOS %', fmt: 'dec' },
  { key: 'msPct', label: 'MS %', fmt: 'pct' },
];

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function blank() {
  return {
    checks: 0, available: 0, orderQty: 0, orderLines: 0, sos: 0, sosN: 0, ms: 0,
    iQty: 0, cQty: 0, inward: 0,
    sessions: new Set(), productive: new Set(), outletSet: new Set(), skuSet: new Set(), skuIn: new Set(),
    reps: new Set(), dates: new Set(), lastDate: '', lastId: 0, sample: null,
  };
}

function add(a, r) {
  a.checks++;
  const inStock = n(r.avail) > 0;
  if (inStock) {
    a.available++;
    a.skuIn.add(r.product_id);
    a.sos += n(r.sos);
    a.sosN++;
  }
  if (n(r.ms) > 0) a.ms++;
  const q = n(r.o_qty);
  a.orderQty += q;
  if (q > 0) {
    a.orderLines++;
    a.productive.add(r.session_id);
  }
  a.iQty += n(r.i_qty);
  a.cQty += n(r.c_qty);
  a.inward += n(r.inward_qty);
  a.sessions.add(r.session_id);
  a.outletSet.add(r.retailer_id);
  a.skuSet.add(r.product_id);
  a.reps.add(r.user_id);
  a.dates.add(r.date);
  if (r.date > a.lastDate) a.lastDate = r.date;
  if (n(r.id) > a.lastId) a.lastId = n(r.id);
  if (!a.sample) a.sample = r;
}

function finish(key, a) {
  const visits = a.sessions.size;
  return {
    key,
    checks: a.checks,
    available: a.available,
    oos: a.checks - a.available,
    availPct: a.checks ? (a.available / a.checks) * 100 : null,
    orderQty: a.orderQty,
    orderLines: a.orderLines,
    visits,
    productiveVisits: a.productive.size,
    strikeRate: visits ? (a.productive.size / visits) * 100 : null,
    outlets: a.outletSet.size,
    skus: a.skuSet.size,
    skusInStock: a.skuIn.size,
    reps: a.reps.size,
    days: a.dates.size,
    skusPerVisit: visits ? a.available / visits : null,
    sosAvg: a.sosN ? a.sos / a.sosN : null,
    msPct: a.checks ? (a.ms / a.checks) * 100 : null,
    iQty: a.iQty,
    cQty: a.cQty,
    inward: a.inward,
    lastDate: a.lastDate,
    lastId: a.lastId,
    sample: a.sample,
  };
}

/** Group rows by a key (string field or function) and compute every metric per group. */
export function groupBy(rows, key) {
  const fn = typeof key === 'function' ? key : (r) => r[key];
  const map = new Map();
  for (const r of rows) {
    let k = fn(r);
    if (k == null || k === '') k = '(blank)';
    let a = map.get(k);
    if (!a) map.set(k, (a = blank()));
    add(a, r);
  }
  return [...map].map(([k, a]) => finish(k, a));
}

export function totals(rows) {
  const a = blank();
  for (const r of rows) add(a, r);
  return finish('all', a);
}

/** Two-level pivot: rows x cols -> metric. */
export function pivot(rows, rowKey, colKey) {
  const map = new Map();
  const cols = new Set();
  for (const r of rows) {
    const rk = r[rowKey] ?? '(blank)';
    const ck = r[colKey] ?? '(blank)';
    cols.add(ck);
    let inner = map.get(rk);
    if (!inner) map.set(rk, (inner = new Map()));
    let a = inner.get(ck);
    if (!a) inner.set(ck, (a = blank()));
    add(a, r);
  }
  const result = [];
  for (const [rk, inner] of map) {
    const cells = {};
    for (const [ck, a] of inner) cells[ck] = finish(ck, a);
    result.push({ key: rk, cells });
  }
  return { rows: result, cols: [...cols] };
}

/** One record per visit (session) with its SKU coverage and order value. */
export function visits(rows) {
  const map = new Map();
  for (const r of rows) {
    let v = map.get(r.session_id);
    if (!v) {
      v = { session_id: r.session_id, id: 0, date: r.date, salesman: r.salesman, o_name: r.o_name, o_code: r.o_code, outlet_type: r.outlet_type, city: r.city, retailer_id: r.retailer_id, checks: 0, available: 0, orderQty: 0, missing: [] };
      map.set(r.session_id, v);
    }
    v.checks++;
    if (n(r.avail) > 0) v.available++;
    else v.missing.push(r.product);
    v.orderQty += n(r.o_qty);
    if (n(r.id) > v.id) v.id = n(r.id);
  }
  return [...map.values()].map((v) => ({ ...v, availPct: v.checks ? (v.available / v.checks) * 100 : 0 }));
}

/** Latest visit per outlet - what the shelf looks like right now. */
export function latestVisitPerOutlet(rows) {
  const best = new Map();
  for (const v of visits(rows)) {
    const cur = best.get(v.retailer_id);
    if (!cur || v.date > cur.date || (v.date === cur.date && v.id > cur.id)) best.set(v.retailer_id, v);
  }
  return [...best.values()];
}

export function outletStatus(pct) {
  if (pct == null) return null;
  if (pct < 40) return { cls: 'bad', label: 'Critical' };
  if (pct < 70) return { cls: 'warn', label: 'Watch' };
  return { cls: 'good', label: 'Healthy' };
}

export function sortBy(arr, key, dir = 'desc') {
  const m = dir === 'desc' ? -1 : 1;
  return [...arr].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x > y ? m : x < y ? -m : 0;
  });
}

/** Keep the top N, fold the remainder into "Other" (sums only). */
export function topWithOther(items, valueKey, nTop = 5) {
  const sorted = sortBy(items, valueKey);
  const head = sorted.slice(0, nTop);
  const rest = sorted.slice(nTop);
  if (rest.length) head.push({ key: 'Other', [valueKey]: rest.reduce((s, x) => s + (x[valueKey] || 0), 0), isOther: true });
  return head;
}
