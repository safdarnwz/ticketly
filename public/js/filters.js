import { DIMENSIONS } from './analytics.js';
import { esc, num, iso, rangeLabel, parseIso } from './format.js';

const CARET = '<svg class="caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const SEARCH_FIELDS = ['o_name', 'o_code', 'salesman', 's_code', 'product', 'prd_code', 'city', 'team', 'tl_name', 'territory', 'cluster'];

export function makeFilterState() {
  return { dims: Object.fromEntries(DIMENSIONS.map((d) => [d.key, new Set()])), search: '' };
}

export function hasActive(f) {
  return Boolean(f.search) || Object.values(f.dims).some((s) => s.size);
}

/** Apply every filter except `skip` (used to compute cross-filtered option counts). */
export function applyFilters(rows, f, skip) {
  const active = Object.entries(f.dims).filter(([k, s]) => s.size && k !== skip);
  const q = f.search.toLowerCase();
  if (!active.length && !q) return rows;
  return rows.filter((r) => {
    for (const [k, s] of active) if (!s.has(String(r[k] ?? '(blank)'))) return false;
    if (q) {
      let hit = false;
      for (const fld of SEARCH_FIELDS) {
        const v = r[fld];
        if (v != null && String(v).toLowerCase().includes(q)) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  });
}

export class FilterBar {
  constructor({ state, getRows, onChange }) {
    this.state = state;
    this.getRows = getRows;
    this.onChange = onChange;
    this.host = document.getElementById('dimFilters');
    this.active = document.getElementById('activeFilters');
    this.clearBtn = document.getElementById('clearFilters');
    this.open = null;
    this.dims = [];
    this.build();

    document.getElementById('moreFilters').addEventListener('click', (e) => {
      const bar = document.getElementById('filterbar');
      bar.classList.toggle('expanded');
      e.currentTarget.textContent = bar.classList.contains('expanded') ? 'Fewer filters' : 'More filters';
    });
    this.clearBtn.addEventListener('click', () => this.clearAll());
    let t;
    const search = document.getElementById('globalSearch');
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.search = search.value.trim();
        this.changed();
      }, 180);
    });
    document.addEventListener('mousedown', (e) => {
      if (this.open && !this.open.contains(e.target)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.active.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-dim]');
      if (!b) return;
      if (b.dataset.dim === '__search') {
        state.search = '';
        search.value = '';
      } else state.dims[b.dataset.dim].delete(b.dataset.val);
      this.changed();
    });
  }

  /** Only offer dimensions that actually exist in the data (the API decides). */
  build(columns) {
    const avail = columns ? new Set(columns) : null;
    this.dims = DIMENSIONS.filter((d) => d.key !== 'date' && d.key !== 'o_name' && (!avail || avail.has(d.key)));
    this.host.innerHTML = this.dims
      .map((d) => `<div class="dd ${d.primary ? '' : 'secondary'}" data-dim="${d.key}"><button class="chip" type="button">${esc(d.label)}<span class="count"></span>${CARET}</button></div>`)
      .join('');
    this.host.querySelectorAll('.dd').forEach((dd) => {
      dd.querySelector('button').addEventListener('click', () => (this.open === dd ? this.close() : this.openDd(dd)));
    });
    this.sync();
  }

  close() {
    if (!this.open) return;
    this.open.querySelector('.popover')?.remove();
    this.open = null;
  }

  openDd(dd) {
    this.close();
    const dim = dd.dataset.dim;
    const sel = this.state.dims[dim];
    const counts = new Map();
    for (const r of applyFilters(this.getRows(), this.state, dim)) {
      const v = String(r[dim] ?? '(blank)');
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    for (const v of sel) if (!counts.has(v)) counts.set(v, 0);
    const opts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const pop = document.createElement('div');
    pop.className = 'popover dd-pop';
    pop.innerHTML = `
      <div class="dd-search"><input type="search" placeholder="Search ${esc(this.dims.find((d) => d.key === dim)?.label.toLowerCase())}…"></div>
      <div class="dd-list"></div>
      <div class="dd-foot"><button class="btn-link" data-a="all" type="button">Select shown</button><button class="btn-link" data-a="none" type="button">Clear</button></div>`;
    dd.appendChild(pop);
    this.open = dd;
    const list = pop.querySelector('.dd-list');
    const input = pop.querySelector('input');
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const shown = opts.filter(([v]) => !q || v.toLowerCase().includes(q)).slice(0, 400);
      list.innerHTML = shown.length
        ? shown.map(([v, c]) => `<label class="dd-opt"><input type="checkbox" value="${esc(v)}" ${sel.has(v) ? 'checked' : ''}><span class="lbl" title="${esc(v)}">${esc(v)}</span><span class="n">${num(c)}</span></label>`).join('')
        : '<div class="dd-empty">Nothing matches</div>';
      return shown;
    };
    let shown = draw();
    input.addEventListener('input', () => (shown = draw()));
    list.addEventListener('change', (e) => {
      if (e.target.checked) sel.add(e.target.value);
      else sel.delete(e.target.value);
      this.changed();
    });
    pop.querySelector('[data-a=all]').addEventListener('click', () => {
      shown.forEach(([v]) => sel.add(v));
      draw();
      this.changed();
    });
    pop.querySelector('[data-a=none]').addEventListener('click', () => {
      sel.clear();
      draw();
      this.changed();
    });
    input.focus();
  }

  /** Toggle a single value (used by chart click-through). */
  toggle(dim, value) {
    const s = this.state.dims[dim];
    if (!s || value == null || value === 'Other') return;
    const v = String(value);
    if (s.has(v) && s.size === 1) s.clear();
    else {
      s.clear();
      s.add(v);
    }
    this.changed();
  }

  clearAll() {
    Object.values(this.state.dims).forEach((s) => s.clear());
    this.state.search = '';
    document.getElementById('globalSearch').value = '';
    this.changed();
  }

  changed() {
    this.sync();
    this.onChange();
  }

  sync() {
    const tags = [];
    this.host.querySelectorAll('.dd').forEach((dd) => {
      const s = this.state.dims[dd.dataset.dim];
      const chip = dd.querySelector('.chip');
      chip.classList.toggle('has-value', s.size > 0);
      chip.querySelector('.count').textContent = s.size ? s.size : '';
      // A selected secondary filter stays visible even when the row is collapsed.
      if (s.size) dd.classList.remove('secondary');
      else if (!DIMENSIONS.find((d) => d.key === dd.dataset.dim)?.primary) dd.classList.add('secondary');
    });
    for (const d of DIMENSIONS) {
      for (const v of this.state.dims[d.key]) tags.push(`<span class="tag">${esc(d.label)}: <b>${esc(v)}</b><button type="button" data-dim="${d.key}" data-val="${esc(v)}" aria-label="Remove">${X}</button></span>`);
    }
    if (this.state.search) tags.push(`<span class="tag">Search: <b>${esc(this.state.search)}</b><button type="button" data-dim="__search" aria-label="Remove">${X}</button></span>`);
    this.active.innerHTML = tags.join('');
    this.clearBtn.hidden = !hasActive(this.state);
  }
}

// ---------- date range ----------

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function presets() {
  const today = new Date();
  const t = iso(today);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthEnd = addDays(firstOfMonth, -1);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return [
    { id: 'today', label: 'Today', start: t, end: t },
    { id: 'yesterday', label: 'Yesterday', start: iso(addDays(today, -1)), end: iso(addDays(today, -1)) },
    { id: 'last7', label: 'Last 7 days', start: iso(addDays(today, -6)), end: t },
    { id: 'mtd', label: 'Month to date', start: iso(firstOfMonth), end: t },
    { id: 'last30', label: 'Last 30 days', start: iso(addDays(today, -29)), end: t },
    { id: 'lastmonth', label: 'Last month', start: iso(lastMonthStart), end: iso(lastMonthEnd) },
  ];
}

export class DateRange {
  constructor({ range, onChange }) {
    this.range = range;
    this.onChange = onChange;
    this.btn = document.getElementById('dateBtn');
    this.pop = document.getElementById('datePop');
    this.list = document.getElementById('presetList');
    this.startIn = document.getElementById('startInput');
    this.endIn = document.getElementById('endInput');
    this.btn.addEventListener('click', () => (this.pop.hidden ? this.show() : this.hide()));
    document.addEventListener('mousedown', (e) => {
      if (!this.pop.hidden && !document.getElementById('dateControl').contains(e.target)) this.hide();
    });
    this.list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      const p = presets().find((x) => x.id === b.dataset.id);
      this.set({ start: p.start, end: p.end, preset: p.id });
    });
    document.getElementById('applyDate').addEventListener('click', () => {
      let s = this.startIn.value;
      let e = this.endIn.value;
      if (!s || !e) return;
      if (s > e) [s, e] = [e, s];
      this.set({ start: s, end: e, preset: null });
    });
    this.label();
  }

  show() {
    const today = iso(new Date());
    this.list.innerHTML = presets()
      .map((p) => `<button type="button" data-id="${p.id}" class="${this.range.preset === p.id ? 'sel' : ''}"><span>${p.label} <small>${rangeLabel(p.start, p.end)}</small></span></button>`)
      .join('');
    this.startIn.value = this.range.start;
    this.endIn.value = this.range.end;
    this.startIn.max = this.endIn.max = today;
    this.pop.hidden = false;
  }

  hide() {
    this.pop.hidden = true;
  }

  set(range) {
    // Presets are relative ("Today"), so re-resolve them on every load.
    this.range = range;
    this.hide();
    this.label();
    this.onChange(range);
  }

  label() {
    const p = presets().find((x) => x.id === this.range.preset);
    if (p) {
      this.range.start = p.start;
      this.range.end = p.end;
    }
    const days = Math.round((parseIso(this.range.end) - parseIso(this.range.start)) / 864e5) + 1;
    document.getElementById('dateLabel').textContent = `${p ? p.label + ' · ' : ''}${rangeLabel(this.range.start, this.range.end)}${!p && days > 1 ? ` · ${days}d` : ''}`;
  }
}
