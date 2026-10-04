import { num, pct, dec, esc, csv, download, shortDate } from './format.js';

const SEARCH_ICON = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
const DL_ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

export const fmtCell = {
  num: (v) => num(v),
  dec: (v) => dec(v),
  pct: (v) => pct(v),
  date: (v) => shortDate(v),
  text: (v) => esc(v ?? '—'),
  meter: (v) =>
    v == null ? '—' : `<span class="meter"><span class="bar"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(1)}%"></i></span><span class="v">${pct(v)}</span></span>`,
};

/**
 * Sortable, searchable, paginated table that keeps its own state across live refreshes.
 * columns: [{ key, label, type: 'text'|'num'|'dec'|'pct'|'meter'|'date', render?, value?, sub?, csv? }]
 */
export class DataTable {
  constructor(el, { columns, sort, dir = 'desc', pageSize = 25, title = 'export', rank = false, onRowClick, searchable = true, toolbarExtra = '' }) {
    this.el = el;
    this.columns = columns;
    this.sort = sort ?? columns[0].key;
    this.dir = dir;
    this.pageSize = pageSize;
    this.page = 0;
    this.query = '';
    this.title = title;
    this.rank = rank;
    this.onRowClick = onRowClick;
    this.rows = [];
    this.view = [];
    el.innerHTML = `
      <div class="dt-tools">
        ${searchable ? `<label class="dt-search">${SEARCH_ICON}<input type="search" placeholder="Filter rows"></label>` : ''}
        ${toolbarExtra}
        <span class="grow"></span>
        <span class="meta"></span>
        <button class="btn btn-sm" data-act="csv" type="button" title="Download CSV">${DL_ICON}CSV</button>
      </div>
      <div class="dt-wrap"><table class="dt"><thead></thead><tbody></tbody></table></div>
      <div class="dt-foot"><span class="range"></span><span class="pager">
        <select class="input" data-act="size">${[10, 25, 50, 100, 500].map((n) => `<option ${n === pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button data-act="prev" type="button" aria-label="Previous page">‹</button>
        <span class="pg"></span>
        <button data-act="next" type="button" aria-label="Next page">›</button>
      </span></div>`;
    this.thead = el.querySelector('thead');
    this.tbody = el.querySelector('tbody');
    const input = el.querySelector('.dt-search input');
    if (input) {
      input.addEventListener('input', () => {
        this.query = input.value.trim().toLowerCase();
        this.page = 0;
        this.render();
      });
    }
    el.querySelector('[data-act=csv]').addEventListener('click', () => this.exportCsv());
    el.querySelector('[data-act=prev]').addEventListener('click', () => this.go(this.page - 1));
    el.querySelector('[data-act=next]').addEventListener('click', () => this.go(this.page + 1));
    el.querySelector('[data-act=size]').addEventListener('change', (e) => {
      this.pageSize = Number(e.target.value);
      this.page = 0;
      this.render();
    });
    this.thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (!th) return;
      const key = th.dataset.key;
      if (this.sort === key) this.dir = this.dir === 'asc' ? 'desc' : 'asc';
      else {
        this.sort = key;
        const col = this.columns.find((c) => c.key === key);
        this.dir = col && (col.type === 'text' || !col.type) ? 'asc' : 'desc';
      }
      this.render();
    });
    this.tbody.addEventListener('click', (e) => {
      if (!this.onRowClick) return;
      const tr = e.target.closest('tr[data-i]');
      if (tr) this.onRowClick(this.pageRows[Number(tr.dataset.i)]);
    });
  }

  setColumns(columns) {
    this.columns = columns;
    if (!columns.some((c) => c.key === this.sort)) this.sort = columns[0]?.key;
    this.render();
  }

  setRows(rows) {
    this.rows = rows;
    this.render();
  }

  go(p) {
    const pages = Math.max(1, Math.ceil(this.view.length / this.pageSize));
    this.page = Math.max(0, Math.min(pages - 1, p));
    this.render();
  }

  valueOf(row, col) {
    return col.value ? col.value(row) : row[col.key];
  }

  compute() {
    let rows = this.rows;
    if (this.query) {
      const q = this.query;
      const textCols = this.columns.filter((c) => c.type === 'text' || !c.type);
      rows = rows.filter((r) => textCols.some((c) => String(this.valueOf(r, c) ?? '').toLowerCase().includes(q)) || (this.columns.some((c) => c.sub && String(c.sub(r) ?? '').toLowerCase().includes(q))));
    }
    const col = this.columns.find((c) => c.key === this.sort);
    if (col) {
      const m = this.dir === 'asc' ? 1 : -1;
      const isText = col.type === 'text' || !col.type;
      rows = [...rows].sort((a, b) => {
        const x = this.valueOf(a, col);
        const y = this.valueOf(b, col);
        if (x == null && y == null) return 0;
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        if (isText) return String(x).localeCompare(String(y), undefined, { numeric: true }) * m;
        return (x > y ? 1 : x < y ? -1 : 0) * m;
      });
    }
    this.view = rows;
  }

  render() {
    this.compute();
    const pages = Math.max(1, Math.ceil(this.view.length / this.pageSize));
    if (this.page >= pages) this.page = pages - 1;
    const start = this.page * this.pageSize;
    this.pageRows = this.view.slice(start, start + this.pageSize);

    const right = (c) => ['num', 'dec', 'pct', 'meter'].includes(c.type);
    this.thead.innerHTML = `<tr>${this.rank ? '<th class="rank">#</th>' : ''}${this.columns
      .map((c) => `<th data-key="${esc(c.key)}" class="${right(c) ? 'num' : ''}" title="${esc(c.hint || '')}">${esc(c.label)}<span class="arrow">${this.sort === c.key ? (this.dir === 'asc' ? '↑' : '↓') : ''}</span></th>`)
      .join('')}</tr>`;

    if (!this.pageRows.length) {
      this.tbody.innerHTML = `<tr><td class="dt-empty" colspan="${this.columns.length + (this.rank ? 1 : 0)}">No rows match.</td></tr>`;
    } else {
      this.tbody.innerHTML = this.pageRows
        .map((r, i) => {
          const cells = this.columns
            .map((c) => {
              const v = this.valueOf(r, c);
              const html = c.render ? c.render(v, r) : (fmtCell[c.type] || fmtCell.text)(v);
              const sub = c.sub ? `<span class="sub">${esc(c.sub(r) ?? '')}</span>` : '';
              const title = c.type === 'text' || !c.type ? ` title="${esc(v ?? '')}"` : '';
              return `<td class="${right(c) ? 'num' : ''} ${c.wrap ? 'wrap' : ''}"${title}>${html}${sub}</td>`;
            })
            .join('');
          return `<tr data-i="${i}" class="${this.onRowClick ? 'clickable' : ''}">${this.rank ? `<td class="rank">${start + i + 1}</td>` : ''}${cells}</tr>`;
        })
        .join('');
    }
    this.el.querySelector('.meta').textContent = `${num(this.view.length)} rows`;
    this.el.querySelector('.range').textContent = this.view.length ? `${num(start + 1)}–${num(Math.min(start + this.pageSize, this.view.length))} of ${num(this.view.length)}` : '';
    this.el.querySelector('.pg').textContent = `${this.page + 1} / ${pages}`;
    this.el.querySelector('[data-act=prev]').disabled = this.page === 0;
    this.el.querySelector('[data-act=next]').disabled = this.page >= pages - 1;
  }

  exportCsv() {
    const cols = this.columns.map((c) => ({ label: c.label, csv: (r) => (c.csv ? c.csv(r) : this.valueOf(r, c)) }));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`${this.title}-${stamp}.csv`, csv(this.view, cols));
  }
}
