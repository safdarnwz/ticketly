import * as A from './analytics.js';
import * as C from './charts.js';
import { num, pct, dec, esc, shortDate, compact } from './format.js';
import { DataTable } from './table.js';
import { card, canvas, kpi, delta, seg, onSeg, setHtml, bindCellTips } from './ui.js';

const statusCell = (s) => (s ? `<span class="status ${s.cls}">${s.label}</span>` : '—');
const hasField = (ctx, f) => ctx.meta.columns.includes(f);

function heatTable(rowsData, cols, { metric = 'availPct', fmt = 'pct', rowLabel = '', maxCols = 24, scaleMax } = {}) {
  const colList = cols.slice(0, maxCols);
  const max = scaleMax ?? Math.max(1, ...rowsData.flatMap((r) => colList.map((c) => r.cells[c]?.[metric] ?? 0)));
  const f = fmt === 'pct' ? (v) => `${v.toFixed(0)}%` : (v) => compact(v);
  const head = `<tr><th>${esc(rowLabel)}</th>${colList.map((c) => `<th title="${esc(c)}">${esc(String(c).length > 14 ? String(c).slice(0, 13) + '…' : c)}</th>`).join('')}</tr>`;
  const body = rowsData
    .map((r) => {
      const tds = colList
        .map((c) => {
          const cell = r.cells[c];
          const v = cell?.[metric];
          if (v == null) return '<td class="na">·</td>';
          const [bg, fg] = C.heatColor(fmt === 'pct' ? v : (v / max) * 100);
          const tipHtml = `<b>${esc(r.key)} · ${esc(c)}</b><br>${f(v)} · ${num(cell.checks)} checks · ${num(cell.visits)} visits`;
          return `<td style="background:${bg};color:${fg}" data-tip="${esc(tipHtml)}">${f(v)}</td>`;
        })
        .join('');
      return `<tr><th title="${esc(r.key)}">${esc(r.key)}</th>${tds}</tr>`;
    })
    .join('');
  const ramp = C.seqRamp().map((c) => `<i style="background:${c}"></i>`).join('');
  return `<div class="heat"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="heat-scale"><span>${fmt === 'pct' ? '0%' : '0'}</span><span class="ramp">${ramp}</span><span>${fmt === 'pct' ? '100%' : compact(max)}</span>${cols.length > maxCols ? `<span>· first ${maxCols} of ${cols.length} columns</span>` : ''}</div>`;
}

// ============================== Overview ==============================

const overview = {
  title: 'Overview',
  sub: 'Shelf health, field activity and orders at a glance',
  mount(el) {
    el.innerHTML = `
      <div class="kpis" data-kpis></div>
      <div class="grid g-21">
        ${card({ title: 'Availability trend', sub: 'Share of SKU checks found on shelf, per day', body: canvas('ovTrend') })}
        ${card({ title: 'Order quantity by brand', sub: 'Top 5 brands, rest grouped', body: `${canvas('ovBrand', 'short')}<div class="legend" data-legend="brand"></div>` })}
      </div>
      <div class="grid g-2">
        ${card({ title: 'Visits per day', body: canvas('ovVisits', 'short') })}
        ${card({ title: 'Order quantity per day', body: canvas('ovOrders', 'short') })}
      </div>
      <div class="grid g-3">
        ${card({ title: 'Availability by region', sub: 'Click a bar to filter', body: canvas('ovRegion', 'short') })}
        ${card({ title: 'Visits by outlet type', body: `${canvas('ovType', 'short')}<div class="legend" data-legend="type"></div>` })}
        ${card({ title: 'Top SKUs by order quantity', body: canvas('ovTopSku', 'short') })}
      </div>
      <div class="grid g-12">
        ${card({ title: 'Latest visits', sub: 'Newest first · updates live', body: '<div class="feed" data-feed></div>', flush: true })}
        ${card({ title: 'Availability by category', sub: 'Click a bar to filter', body: canvas('ovCat', 'tall') })}
      </div>`;
  },
  update(el, ctx) {
    const { rows } = ctx;
    const t = A.totals(rows);
    const days = A.sortBy(A.groupBy(rows, 'date'), 'key', 'asc');
    const last = days[days.length - 1];
    const prev = days[days.length - 2];
    const vis = A.visits(rows);
    const WELL = 80;
    const well = (v) => (v.length ? (v.filter((x) => x.availPct >= WELL).length / v.length) * 100 : null);
    const avgPerDay = (k) => (days.length ? days.reduce((s, d) => s + d[k], 0) / days.length : 0);
    // Counts compare the latest day with the daily average (the latest day may still be in progress);
    // ratios compare day over day.
    const countFoot = (k, fmt = num) => (days.length > 1 ? `${fmt(last[k])} on ${shortDate(last.key)} · ${fmt(avgPerDay(k))}/day avg` : '');
    const vsLabel = prev ? `${shortDate(last.key)} vs ${shortDate(prev.key)}` : '';
    const lastVis = last ? A.visits(rows.filter((r) => r.date === last.key)) : [];
    const prevVis = prev ? A.visits(rows.filter((r) => r.date === prev.key)) : [];

    setHtml(el, '[data-kpis]', [
      kpi({ label: 'Availability', value: t.availPct == null ? '—' : t.availPct.toFixed(1), unit: '%', foot: prev ? delta(last.availPct, prev.availPct, { pts: true, label: vsLabel }) : `${num(t.available)} of ${num(t.checks)} checks`, title: 'SKU checks found in stock / all SKU checks' }),
      kpi({ label: 'Out-of-stock checks', value: num(t.oos), foot: countFoot('oos') || `across ${num(t.outlets)} outlets` }),
      kpi({ label: 'Outlet visits', value: num(t.visits), foot: countFoot('visits') || `${num(t.outlets)} unique outlets` }),
      kpi({ label: 'Order quantity', value: compact(t.orderQty), foot: countFoot('orderQty', compact) || `${num(t.orderLines)} order lines` }),
      kpi({ label: 'Strike rate', value: t.strikeRate == null ? '—' : t.strikeRate.toFixed(1), unit: '%', foot: prev ? delta(last.strikeRate, prev.strikeRate, { pts: true, label: vsLabel }) : `${num(t.productiveVisits)} productive visits`, title: 'Visits with at least one order / all visits' }),
      kpi({ label: 'SKUs in stock per visit', value: dec(t.skusPerVisit), unit: ` / ${num(t.skus)}`, foot: `${num(t.skus)} SKUs tracked` }),
      kpi({ label: `Well-stocked visits`, value: vis.length ? well(vis).toFixed(1) : '—', unit: '%', foot: prev ? delta(well(lastVis), well(prevVis), { pts: true, label: vsLabel }) : `≥ ${WELL}% of SKUs on shelf`, title: `Visits where at least ${WELL}% of tracked SKUs were on shelf` }),
      kpi({ label: 'Active reps', value: num(t.reps), foot: `${dec(t.reps && t.days ? t.visits / t.reps / t.days : null)} visits / rep / day` }),
    ].join(''));

    const labels = days.map((d) => shortDate(d.key));
    C.line('ovTrend', { labels, datasets: [{ label: 'Availability', data: days.map((d) => d.availPct), color: C.css('--s1') }], fmt: 'pct', max: 100, area: true });
    C.bar('ovVisits', { labels, values: days.map((d) => d.visits) });
    C.bar('ovOrders', { labels, values: days.map((d) => d.orderQty) });

    const brands = A.topWithOther(A.groupBy(rows, 'brand'), 'orderQty', 5).filter((b) => b.orderQty > 0);
    const bColors = brands.map((b) => C.colorFor('brand', b.key));
    C.donut('ovBrand', { labels: brands.map((b) => b.key), values: brands.map((b) => b.orderQty), colors: bColors, onClick: (v) => ctx.filter('brand', v) });
    setHtml(el, '[data-legend=brand]', brands.length ? C.legendHtml(brands.map((b) => b.key), bColors, brands.map((b) => b.orderQty)) : '<span>No orders in this selection</span>');

    const regions = A.sortBy(A.groupBy(rows, 'region'), 'availPct');
    C.bar('ovRegion', { labels: regions.map((r) => r.key), values: regions.map((r) => r.availPct), fmt: 'pct', max: 100, onClick: (v) => ctx.filter('region', v), tooltipExtra: (i) => `${num(regions[i].visits)} visits · ${num(regions[i].oos)} OOS checks` });

    const types = A.topWithOther(A.groupBy(rows, 'outlet_type'), 'visits', 5);
    const tColors = types.map((x) => C.colorFor('outlet_type', x.key));
    C.donut('ovType', { labels: types.map((x) => x.key), values: types.map((x) => x.visits), colors: tColors, onClick: (v) => ctx.filter('outlet_type', v) });
    setHtml(el, '[data-legend=type]', C.legendHtml(types.map((x) => x.key), tColors, types.map((x) => x.visits)));

    const skus = A.sortBy(A.groupBy(rows, 'product'), 'orderQty').filter((s) => s.orderQty > 0).slice(0, 8);
    C.bar('ovTopSku', { labels: skus.map((s) => s.key), values: skus.map((s) => s.orderQty), horizontal: true, onClick: (v) => ctx.filter('product', v), labelChars: 22 });

    const cats = A.sortBy(A.groupBy(rows, 'category'), 'availPct');
    C.bar('ovCat', { labels: cats.map((c) => c.key), values: cats.map((c) => c.availPct), fmt: 'pct', max: 100, horizontal: true, onClick: (v) => ctx.filter('category', v), tooltipExtra: (i) => `${num(cats[i].checks)} checks · ${num(cats[i].orderQty)} ordered` });

    const feed = A.sortBy(vis, 'id').slice(0, 40);
    setHtml(el, '[data-feed]', feed.length
      ? feed.map((v) => {
        const s = A.outletStatus(v.availPct);
        return `<div class="feed-item ${ctx.freshSessions.has(v.session_id) ? 'fresh' : ''}">
          <span class="t" title="${esc(v.o_name)}">${esc(v.o_name)}</span><span class="r">${statusCell(s)}</span>
          <span class="s">${esc(v.salesman)} · ${shortDate(v.date)} · ${esc(v.outlet_type || '')}</span>
          <span class="s r">${v.available}/${v.checks} SKUs · ${num(v.orderQty)} qty</span>
        </div>`;
      }).join('')
      : '<div class="dt-empty">No visits in this selection.</div>');
  },
};

// ============================== SKU availability ==============================

const availability = {
  title: 'SKU availability',
  sub: 'Which products are missing from shelves, and where',
  mount(el, ctx) {
    this.rowDim = 'region';
    this.colDim = 'category';
    const rowDims = ['region', 'cluster', 'territory', 'team', 'salesman', 'outlet_type', 'class'].filter((d) => hasField(ctx, d));
    const lbl = (k) => A.DIMENSIONS.find((d) => d.key === k)?.label || k;
    el.innerHTML = `
      <div class="kpis" data-kpis></div>
      <div class="grid g-2">
        ${card({ title: 'Availability by category', sub: 'Click to filter', body: canvas('avCat') })}
        ${card({ title: 'Availability by brand', sub: 'Click to filter', body: canvas('avBrand') })}
      </div>
      ${card({ title: 'Availability heatmap', sub: 'Darker = better stocked. Hover a cell for detail.', actions: `<div class="row-gap">${seg('avRow', rowDims.map((k) => ({ key: k, label: lbl(k) })), this.rowDim)}${seg('avCol', [{ key: 'category', label: 'Category' }, { key: 'brand', label: 'Brand' }, { key: 'product', label: 'SKU' }], this.colDim)}</div>`, body: '<div data-heat></div>' })}
      <div class="grid g-2">
        ${card({ title: 'Lowest availability SKUs', sub: 'Bottom 12 by share of checks in stock', body: canvas('avLow', 'tall') })}
        ${card({ title: 'Out-of-stock checks by SKU', sub: 'Biggest gaps first · tooltip shows cumulative share', body: canvas('avOos', 'tall') })}
      </div>
      ${card({ title: 'SKU scorecard', sub: 'Every tracked product in the current selection', body: '<div data-table></div>', flush: true })}`;
    onSeg(el, 'avRow', (v) => { this.rowDim = v; this.update(el, ctx.current()); });
    onSeg(el, 'avCol', (v) => { this.colDim = v; this.update(el, ctx.current()); });
    bindCellTips(el);
    this.table = new DataTable(el.querySelector('[data-table]'), {
      title: 'sku-scorecard', sort: 'availPct', dir: 'asc', rank: true,
      onRowClick: (r) => ctx.filter('product', r.key),
      columns: [
        { key: 'key', label: 'SKU', sub: (r) => [r.sample?.prd_code, r.sample?.brand].filter(Boolean).join(' · ') },
        { key: 'category', label: 'Category', value: (r) => r.sample?.category },
        { key: 'availPct', label: 'Availability', type: 'meter' },
        { key: 'checks', label: 'Checks', type: 'num' },
        { key: 'oos', label: 'OOS checks', type: 'num' },
        { key: 'outlets', label: 'Outlets', type: 'num' },
        { key: 'orderQty', label: 'Order qty', type: 'num' },
        { key: 'orderLines', label: 'Order lines', type: 'num' },
        { key: 'orderRate', label: 'Ordered when stocked', type: 'pct', hint: 'Order lines / in-stock checks' },
        { key: 'sosAvg', label: 'Avg SOS', type: 'dec' },
        { key: 'lastDate', label: 'Last seen', type: 'date' },
      ],
    });
  },
  update(el, ctx) {
    const { rows } = ctx;
    const prods = A.groupBy(rows, 'product').map((p) => ({ ...p, orderRate: p.available ? (p.orderLines / p.available) * 100 : null }));
    const t = A.totals(rows);
    const vis = A.visits(rows);
    const under = prods.filter((p) => p.availPct != null && p.availPct < 50).length;
    const full = vis.filter((v) => v.availPct >= 80).length;
    const best = A.sortBy(prods, 'availPct')[0];
    setHtml(el, '[data-kpis]', [
      kpi({ label: 'SKUs tracked', value: num(prods.length), foot: `${num(t.checks)} checks in total` }),
      kpi({ label: 'Average availability', value: t.availPct == null ? '—' : t.availPct.toFixed(1), unit: '%', foot: `${num(t.oos)} out-of-stock checks` }),
      kpi({ label: 'SKUs below 50%', value: num(under), foot: prods.length ? `${((under / prods.length) * 100).toFixed(0)}% of the range` : '' }),
      kpi({ label: 'Best stocked SKU', value: best ? pct(best.availPct, 0) : '—', foot: best ? esc(best.key) : '' }),
      kpi({ label: 'Well-stocked visits', value: vis.length ? ((full / vis.length) * 100).toFixed(1) : '—', unit: '%', foot: `${num(full)} of ${num(vis.length)} visits ≥ 80%` }),
      kpi({ label: 'In-stock but not ordered', value: num(t.available - rows.filter((r) => Number(r.avail) > 0 && Number(r.o_qty) > 0).length), foot: 'checks — upsell headroom' }),
      kpi({ label: 'Categories', value: num(new Set(rows.map((r) => r.category)).size), foot: `${num(new Set(rows.map((r) => r.brand)).size)} brands` }),
      kpi({ label: 'Avg share of shelf', value: t.sosAvg == null ? '—' : t.sosAvg.toFixed(1), unit: '%', foot: 'where the SKU was in stock' }),
    ].join(''));

    const cats = A.sortBy(A.groupBy(rows, 'category'), 'availPct');
    C.bar('avCat', { labels: cats.map((c) => c.key), values: cats.map((c) => c.availPct), fmt: 'pct', max: 100, horizontal: true, onClick: (v) => ctx.filter('category', v) });
    const brands = A.sortBy(A.groupBy(rows, 'brand'), 'availPct');
    C.bar('avBrand', { labels: brands.map((c) => c.key), values: brands.map((c) => c.availPct), fmt: 'pct', max: 100, horizontal: true, colors: brands.map((b) => C.colorFor('brand', b.key)), onClick: (v) => ctx.filter('brand', v) });

    const pv = A.pivot(rows, this.rowDim, this.colDim);
    const colOrder = A.sortBy(A.groupBy(rows, this.colDim), 'checks').map((c) => c.key);
    const rowsData = pv.rows.map((r) => ({ ...r, avg: A.totals(rows.filter((x) => x[this.rowDim] === r.key)).availPct }));
    rowsData.sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
    setHtml(el, '[data-heat]', heatTable(rowsData.slice(0, 40), colOrder, { rowLabel: A.DIMENSIONS.find((d) => d.key === this.rowDim)?.label }));

    const low = A.sortBy(prods.filter((p) => p.checks >= 3), 'availPct', 'asc').slice(0, 12);
    C.bar('avLow', { labels: low.map((p) => p.key), values: low.map((p) => p.availPct), fmt: 'pct', max: 100, horizontal: true, color: C.css('--s2'), onClick: (v) => ctx.filter('product', v), labelChars: 26 });

    const oos = A.sortBy(prods, 'oos').filter((p) => p.oos > 0).slice(0, 12);
    const totalOos = prods.reduce((s, p) => s + p.oos, 0) || 1;
    let cum = 0;
    const cumPct = oos.map((p) => ((cum += p.oos) / totalOos) * 100);
    C.bar('avOos', { labels: oos.map((p) => p.key), values: oos.map((p) => p.oos), horizontal: true, onClick: (v) => ctx.filter('product', v), labelChars: 26, tooltipExtra: (i) => `Top ${i + 1} SKUs = ${cumPct[i].toFixed(0)}% of all OOS` });

    this.table.setRows(prods.map((p) => ({ ...p, category: p.sample?.category })));
  },
};

// ============================== Outlets ==============================

const BANDS = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];

const outlets = {
  title: 'Outlets',
  sub: 'Outlet-level shelf health and where to send a rep next',
  mount(el, ctx) {
    el.innerHTML = `
      <div class="kpis" data-kpis></div>
      <div class="grid g-3">
        ${card({ title: 'Outlets by availability band', sub: 'Based on each outlet’s latest visit', body: canvas('olBand', 'short') })}
        ${card({ title: 'Outlets by type', body: `${canvas('olType', 'short')}<div class="legend" data-legend></div>` })}
        ${card({ title: 'Availability by outlet class', sub: 'Click to filter', body: canvas('olClass', 'short') })}
      </div>
      ${card({ title: 'Outlet scorecard', sub: 'Click a row to focus on that outlet', body: '<div data-table></div>', flush: true })}`;
    this.table = new DataTable(el.querySelector('[data-table]'), {
      title: 'outlet-scorecard', sort: 'latestPct', dir: 'asc',
      onRowClick: (r) => ctx.search(r.o_code || r.o_name),
      columns: [
        { key: 'o_name', label: 'Outlet', sub: (r) => [r.o_code, r.city].filter(Boolean).join(' · ') },
        { key: 'outlet_type', label: 'Type' },
        { key: 'class', label: 'Class', render: (v) => esc(String(v ?? '—').toUpperCase()) },
        { key: 'salesman', label: 'Salesman' },
        { key: 'visits', label: 'Visits', type: 'num' },
        { key: 'lastDate', label: 'Last visit', type: 'date' },
        { key: 'availPct', label: 'Availability (range)', type: 'meter' },
        { key: 'latestPct', label: 'Last visit %', type: 'pct', hint: 'Availability at the latest visit' },
        { key: 'missingCount', label: 'Missing SKUs', type: 'num', render: (v, r) => `<span title="${esc(r.missing.join(', '))}">${num(v)}</span>` },
        { key: 'orderQty', label: 'Order qty', type: 'num' },
        { key: 'statusRank', label: 'Status', type: 'num', render: (_v, r) => statusCell(A.outletStatus(r.latestPct)), csv: (r) => A.outletStatus(r.latestPct)?.label },
      ],
    });
  },
  update(el, ctx) {
    const { rows } = ctx;
    const latest = new Map(A.latestVisitPerOutlet(rows).map((v) => [v.retailer_id, v]));
    const list = A.groupBy(rows, 'retailer_id').map((o) => {
      const l = latest.get(o.key);
      const s = o.sample;
      return {
        ...o, o_name: s.o_name, o_code: s.o_code, city: s.city, outlet_type: s.outlet_type, class: s.class, salesman: s.salesman,
        latestPct: l?.availPct ?? null, missing: l?.missing || [], missingCount: l?.missing.length || 0,
        statusRank: l ? l.availPct : null,
      };
    });
    const critical = list.filter((o) => o.latestPct != null && o.latestPct < 40).length;
    const noOrder = list.filter((o) => o.orderQty === 0).length;
    const t = A.totals(rows);
    setHtml(el, '[data-kpis]', [
      kpi({ label: 'Outlets covered', value: num(list.length), foot: `${num(t.visits)} visits` }),
      kpi({ label: 'Critical outlets', value: num(critical), foot: '<span class="status bad">under 40% at last visit</span>' }),
      kpi({ label: 'Outlets with no order', value: num(noOrder), foot: list.length ? `${((noOrder / list.length) * 100).toFixed(0)}% of outlets visited` : '' }),
      kpi({ label: 'Visits per outlet', value: dec(list.length ? t.visits / list.length : null), foot: `over ${num(t.days)} day${t.days === 1 ? '' : 's'}` }),
    ].join(''));

    const ramp = C.seqRamp();
    const bandCounts = BANDS.map(([lo, hi]) => list.filter((o) => o.latestPct != null && o.latestPct >= lo && o.latestPct < hi).length);
    C.bar('olBand', { labels: ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'], values: bandCounts, colors: [ramp[2], ramp[3], ramp[4], ramp[5], ramp[6]] });

    const types = A.topWithOther(A.groupBy(rows, 'outlet_type'), 'outlets', 5);
    const colors = types.map((x) => C.colorFor('outlet_type', x.key));
    C.donut('olType', { labels: types.map((x) => x.key), values: types.map((x) => x.outlets), colors, onClick: (v) => ctx.filter('outlet_type', v) });
    setHtml(el, '[data-legend]', C.legendHtml(types.map((x) => x.key), colors, types.map((x) => x.outlets)));

    const classes = A.sortBy(A.groupBy(rows, 'class'), 'key', 'asc');
    C.bar('olClass', { labels: classes.map((c) => String(c.key).toUpperCase()), values: classes.map((c) => c.availPct), fmt: 'pct', max: 100, onClick: (_v, i) => ctx.filter('class', classes[i].key), tooltipExtra: (i) => `${num(classes[i].outlets)} outlets` });

    this.table.setRows(list);
  },
};

// ============================== Field team ==============================

const team = {
  title: 'Field team',
  sub: 'Rep productivity, coverage discipline and team comparison',
  mount(el, ctx) {
    el.innerHTML = `
      <div class="kpis" data-kpis></div>
      <div class="grid g-2">
        ${card({ title: 'Order quantity by rep', sub: 'Top 15 · click to filter', body: canvas('tmOrders', 'tall') })}
        ${card({ title: 'Visits vs availability', sub: 'Each dot is a rep · top-right is where you want them', body: canvas('tmScatter', 'tall') })}
      </div>
      ${card({ title: 'Rep leaderboard', body: '<div data-reps></div>', flush: true })}
      <div class="grid g-2">
        ${card({ title: 'Team summary', sub: 'Grouped by team leader', body: '<div data-teams></div>', flush: true })}
        ${card({ title: 'Daily coverage', sub: 'Visits per rep per day', body: '<div data-cov></div>' })}
      </div>`;
    bindCellTips(el);
    this.reps = new DataTable(el.querySelector('[data-reps]'), {
      title: 'rep-leaderboard', sort: 'orderQty', rank: true,
      onRowClick: (r) => ctx.filter('salesman', r.key),
      columns: [
        { key: 'key', label: 'Salesman', sub: (r) => [r.sample?.s_code, r.sample?.territory].filter(Boolean).join(' · ') },
        { key: 'tl', label: 'Team leader', value: (r) => r.sample?.tl_name },
        { key: 'days', label: 'Days active', type: 'num' },
        { key: 'visits', label: 'Visits', type: 'num' },
        { key: 'perDay', label: 'Visits / day', type: 'dec' },
        { key: 'outlets', label: 'Outlets', type: 'num' },
        { key: 'availPct', label: 'Availability', type: 'meter' },
        { key: 'skusPerVisit', label: 'SKUs / visit', type: 'dec' },
        { key: 'strikeRate', label: 'Strike rate', type: 'pct' },
        { key: 'orderQty', label: 'Order qty', type: 'num' },
        { key: 'lastDate', label: 'Last visit', type: 'date' },
      ],
    });
    this.teams = new DataTable(el.querySelector('[data-teams]'), {
      title: 'team-summary', sort: 'orderQty', pageSize: 10, searchable: false,
      onRowClick: (r) => ctx.filter('team', r.key),
      columns: [
        { key: 'key', label: 'Team', sub: (r) => r.sample?.tl_name },
        { key: 'reps', label: 'Reps', type: 'num' },
        { key: 'visits', label: 'Visits', type: 'num' },
        { key: 'availPct', label: 'Availability', type: 'pct' },
        { key: 'strikeRate', label: 'Strike rate', type: 'pct' },
        { key: 'orderQty', label: 'Order qty', type: 'num' },
      ],
    });
  },
  update(el, ctx) {
    const { rows } = ctx;
    const reps = A.groupBy(rows, 'salesman').map((r) => ({ ...r, perDay: r.days ? r.visits / r.days : null, tl: r.sample?.tl_name }));
    const t = A.totals(rows);
    const eligible = reps.filter((r) => r.visits >= 2);
    const bestStrike = A.sortBy(eligible, 'strikeRate')[0];
    const lowAvail = A.sortBy(eligible, 'availPct', 'asc')[0];
    setHtml(el, '[data-kpis]', [
      kpi({ label: 'Active reps', value: num(reps.length), foot: `${num(new Set(rows.map((r) => r.team)).size)} teams` }),
      kpi({ label: 'Visits per rep per day', value: dec(t.reps && t.days ? t.visits / t.reps / t.days : null), foot: `${num(t.visits)} visits in total` }),
      kpi({ label: 'Best strike rate', value: bestStrike ? pct(bestStrike.strikeRate, 0) : '—', foot: bestStrike ? esc(bestStrike.key) : '' }),
      kpi({ label: 'Lowest shelf availability', value: lowAvail ? pct(lowAvail.availPct, 0) : '—', foot: lowAvail ? esc(lowAvail.key) : '' }),
    ].join(''));

    const top = A.sortBy(reps, 'orderQty').slice(0, 15);
    C.bar('tmOrders', { labels: top.map((r) => r.key), values: top.map((r) => r.orderQty), horizontal: true, onClick: (v) => ctx.filter('salesman', v), labelChars: 22, tooltipExtra: (i) => `${num(top[i].visits)} visits · strike ${pct(top[i].strikeRate, 0)}` });
    C.scatter('tmScatter', { points: reps.map((r) => ({ x: r.visits, y: r.availPct, label: r.key })), xLabel: 'Visits', yLabel: 'Availability', onClick: (p) => ctx.filter('salesman', p.label) });

    this.reps.setRows(reps);
    this.teams.setRows(A.groupBy(rows, 'team'));

    const dates = [...new Set(rows.map((r) => r.date))].sort();
    if (dates.length > 1 && dates.length <= 45) {
      const pv = A.pivot(rows, 'salesman', 'date');
      pv.rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      const html = heatTable(pv.rows, dates, { metric: 'visits', fmt: 'num', rowLabel: 'Rep', maxCols: 45 }).replace(/<th title="(\d{4}-\d{2}-\d{2})">[^<]*<\/th>/g, (_m, d) => `<th title="${d}">${shortDate(d)}</th>`);
      setHtml(el, '[data-cov]', html);
    } else {
      setHtml(el, '[data-cov]', '<div class="dt-empty">Pick a date range of 2–45 days to see daily coverage.</div>');
    }
  },
};

// ============================== Geography ==============================

const geography = {
  title: 'Geography',
  sub: 'Region, cluster, territory and city comparison',
  mount(el, ctx) {
    const dims = ['region', 'cluster', 'territory', 'state', 'city', 'pteam'].filter((d) => hasField(ctx, d));
    this.dim = dims[0] || 'region';
    const lbl = (k) => A.DIMENSIONS.find((d) => d.key === k)?.label || k;
    el.innerHTML = `
      <div>${seg('geoDim', dims.map((k) => ({ key: k, label: lbl(k) })), this.dim)}</div>
      <div class="grid g-2">
        ${card({ title: 'Availability', sub: 'Click a bar to filter', body: canvas('geoAvail', 'tall') })}
        ${card({ title: 'Order quantity', sub: 'Click a bar to filter', body: canvas('geoOrders', 'tall') })}
      </div>
      <div class="grid g-12">
        ${card({ title: 'Share of visits by region', body: `${canvas('geoShare', 'short')}<div class="legend" data-legend></div>` })}
        ${card({ title: 'Strike rate', sub: 'Visits that produced an order', body: canvas('geoStrike', 'short') })}
      </div>
      ${card({ title: 'Breakdown', body: '<div data-table></div>', flush: true })}`;
    onSeg(el, 'geoDim', (v) => { this.dim = v; this.update(el, ctx.current()); });
    this.table = new DataTable(el.querySelector('[data-table]'), {
      title: 'geography', sort: 'orderQty', rank: true,
      onRowClick: (r) => ctx.filter(this.dim, r.key),
      columns: [
        { key: 'key', label: 'Name' },
        { key: 'outlets', label: 'Outlets', type: 'num' },
        { key: 'reps', label: 'Reps', type: 'num' },
        { key: 'visits', label: 'Visits', type: 'num' },
        { key: 'availPct', label: 'Availability', type: 'meter' },
        { key: 'oos', label: 'OOS checks', type: 'num' },
        { key: 'strikeRate', label: 'Strike rate', type: 'pct' },
        { key: 'orderQty', label: 'Order qty', type: 'num' },
        { key: 'skusPerVisit', label: 'SKUs / visit', type: 'dec' },
      ],
    });
  },
  update(el, ctx) {
    const { rows } = ctx;
    const groups = A.groupBy(rows, this.dim);
    const byAvail = A.sortBy(groups, 'availPct').slice(0, 20);
    C.bar('geoAvail', { labels: byAvail.map((g) => g.key), values: byAvail.map((g) => g.availPct), fmt: 'pct', max: 100, horizontal: true, onClick: (v) => ctx.filter(this.dim, v) });
    const byOrd = A.sortBy(groups, 'orderQty').slice(0, 20);
    C.bar('geoOrders', { labels: byOrd.map((g) => g.key), values: byOrd.map((g) => g.orderQty), horizontal: true, onClick: (v) => ctx.filter(this.dim, v) });
    const regions = A.topWithOther(A.groupBy(rows, 'region'), 'visits', 6);
    const colors = regions.map((r) => C.colorFor('region', r.key));
    C.donut('geoShare', { labels: regions.map((r) => r.key), values: regions.map((r) => r.visits), colors, onClick: (v) => ctx.filter('region', v) });
    setHtml(el, '[data-legend]', C.legendHtml(regions.map((r) => r.key), colors, regions.map((r) => r.visits)));
    const byStrike = A.sortBy(groups, 'strikeRate').slice(0, 20);
    C.bar('geoStrike', { labels: byStrike.map((g) => g.key), values: byStrike.map((g) => g.strikeRate), fmt: 'pct', max: 100, onClick: (v) => ctx.filter(this.dim, v) });
    this.table.setRows(groups);
  },
};

// ============================== Opportunities ==============================

const opportunities = {
  title: 'Opportunities',
  sub: 'Auto-generated actions ranked by business impact',
  mount(el, ctx) {
    el.innerHTML = `
      <div class="insights" data-insights></div>
      ${card({ title: 'Restock list', sub: 'Outlets whose latest visit had the most missing SKUs — send these to the distributor', body: '<div data-gaps></div>', flush: true })}
      ${card({ title: 'Upsell list', sub: 'SKU on the shelf but nothing ordered on that visit', body: '<div data-upsell></div>', flush: true })}
      <section data-stock></section>`;
    this.gaps = new DataTable(el.querySelector('[data-gaps]'), {
      title: 'restock-list', sort: 'missingCount', rank: true,
      onRowClick: (r) => ctx.search(r.o_code || r.o_name),
      columns: [
        { key: 'o_name', label: 'Outlet', sub: (r) => [r.o_code, r.city].filter(Boolean).join(' · ') },
        { key: 'outlet_type', label: 'Type' },
        { key: 'salesman', label: 'Salesman' },
        { key: 'date', label: 'Last visit', type: 'date' },
        { key: 'availPct', label: 'Availability', type: 'meter' },
        { key: 'missingCount', label: 'Missing', type: 'num' },
        { key: 'missingList', label: 'Missing SKUs', wrap: true },
      ],
    });
    this.upsell = new DataTable(el.querySelector('[data-upsell]'), {
      title: 'upsell-list', sort: 'idle',
      onRowClick: (r) => ctx.filter('product', r.key),
      columns: [
        { key: 'key', label: 'SKU', sub: (r) => r.sample?.brand },
        { key: 'available', label: 'In-stock checks', type: 'num' },
        { key: 'idle', label: 'In stock, not ordered', type: 'num' },
        { key: 'idlePct', label: 'Idle share', type: 'meter' },
        { key: 'outletsIdle', label: 'Outlets', type: 'num' },
        { key: 'orderQty', label: 'Order qty so far', type: 'num' },
      ],
    });
    this.stockMounted = false;
  },
  update(el, ctx) {
    const { rows } = ctx;
    const t = A.totals(rows);
    const prods = A.groupBy(rows, 'product');
    const latest = A.latestVisitPerOutlet(rows);
    const reps = A.groupBy(rows, 'salesman');
    const cards = [];

    // 1. Pareto of out-of-stock
    const oosTop = A.sortBy(prods, 'oos').filter((p) => p.oos > 0).slice(0, 5);
    if (oosTop.length && t.oos) {
      const share = (oosTop.reduce((s, p) => s + p.oos, 0) / t.oos) * 100;
      cards.push({ sev: share > 50 ? 'bad' : 'warn', title: 'Fix these SKUs first', num: `${share.toFixed(0)}%`, text: `of all out-of-stock checks come from just ${oosTop.length} SKUs.`, list: oosTop.map((p) => `${p.key} — ${pct(p.availPct, 0)} available`), action: 'Push secondary orders and distributor fill-rate for these SKUs before anything else.' });
    }
    // 2. Critical outlets
    const crit = latest.filter((v) => v.availPct < 40);
    if (latest.length) {
      cards.push({ sev: crit.length ? 'bad' : 'good', title: 'Outlets in critical state', num: num(crit.length), text: `of ${num(latest.length)} outlets were under 40% availability at their latest visit.`, list: A.sortBy(crit, 'availPct', 'asc').slice(0, 4).map((v) => `${v.o_name} — ${v.available}/${v.checks} SKUs`), action: 'Schedule a restock visit; see the Restock list below.' });
    }
    // 3. Upsell headroom
    const instockNoOrder = rows.filter((r) => Number(r.avail) > 0 && !(Number(r.o_qty) > 0)).length;
    if (t.available) {
      const sh = (instockNoOrder / t.available) * 100;
      cards.push({ sev: sh > 70 ? 'warn' : 'good', title: 'In stock, but not ordered', num: `${sh.toFixed(0)}%`, text: `of in-stock checks (${num(instockNoOrder)}) produced no order on that visit.`, action: 'Brief reps to pitch top-up orders on listed SKUs — the shelf space is already won.' });
    }
    // 4. Reps under-converting
    if (t.strikeRate != null) {
      const weak = reps.filter((r) => r.visits >= 3 && r.strikeRate < t.strikeRate * 0.75);
      cards.push({ sev: weak.length ? 'warn' : 'good', title: 'Reps under-converting visits', num: num(weak.length), text: `reps have a strike rate below 75% of the team average (${pct(t.strikeRate, 0)}).`, list: A.sortBy(weak, 'strikeRate', 'asc').slice(0, 4).map((r) => `${r.key} — ${pct(r.strikeRate, 0)} over ${r.visits} visits`), action: 'Ride-along coaching or route review for these reps.' });
    }
    // 5. Class A outlets slipping
    const outletClass = new Map(rows.map((r) => [r.retailer_id, String(r.class ?? '').toLowerCase()]));
    const classA = latest.filter((v) => outletClass.get(v.retailer_id) === 'a');
    if (classA.length) {
      const weakA = classA.filter((v) => v.availPct < (t.availPct ?? 0));
      cards.push({ sev: weakA.length ? 'warn' : 'good', title: 'Class A outlets below average', num: num(weakA.length), text: `of ${num(classA.length)} class A outlets are stocked worse than the overall ${pct(t.availPct, 0)}.`, list: A.sortBy(weakA, 'availPct', 'asc').slice(0, 4).map((v) => `${v.o_name} — ${pct(v.availPct, 0)}`), action: 'These are your highest-throughput doors: prioritise them in tomorrow’s beat.' });
    }
    // 6. Never ordered SKUs
    const never = prods.filter((p) => p.orderQty === 0);
    if (prods.length) {
      cards.push({ sev: never.length ? 'warn' : 'good', title: 'SKUs with zero orders', num: num(never.length), text: `of ${num(prods.length)} tracked SKUs had no order at all in this period.`, list: never.slice(0, 4).map((p) => `${p.key} — ${pct(p.availPct, 0)} available`), action: 'Check scheme/visibility support or consider rationalising the range.' });
    }
    // 7. Weakest region x category cell
    if (hasField(ctx, 'region') && hasField(ctx, 'category')) {
      const pv = A.pivot(rows, 'region', 'category');
      let worst = null;
      for (const r of pv.rows) for (const [c, cell] of Object.entries(r.cells)) if (cell.checks >= 10 && (!worst || cell.availPct < worst.v)) worst = { r: r.key, c, v: cell.availPct, n: cell.checks };
      if (worst) cards.push({ sev: worst.v < 40 ? 'bad' : 'warn', title: 'Weakest region × category', num: pct(worst.v, 0), text: `${worst.c} in ${worst.r} (${num(worst.n)} checks).`, action: `Review distributor stock for ${worst.c} in ${worst.r}.` });
    }

    setHtml(el, '[data-insights]', cards.length ? cards.map((c) => `
      <article class="insight">
        <div class="insight-top"><h3>${esc(c.title)}</h3><span class="status ${c.sev}">${c.sev === 'bad' ? 'Act now' : c.sev === 'warn' ? 'Watch' : 'On track'}</span></div>
        <div><span class="num">${c.num}</span> <span style="color:var(--ink-2)">${esc(c.text)}</span></div>
        ${c.list && c.list.length ? `<ul>${c.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="action"><b>Action:</b> ${esc(c.action)}</div>
      </article>`).join('') : '<div class="empty-state"><h3>No data</h3>Pick a wider date range.</div>');

    const outletInfo = new Map(rows.map((r) => [r.retailer_id, r]));
    this.gaps.setRows(latest.filter((v) => v.missing.length).map((v) => ({
      ...v, city: outletInfo.get(v.retailer_id)?.city, missingCount: v.missing.length,
      missingList: v.missing.slice(0, 3).join(', ') + (v.missing.length > 3 ? ` +${v.missing.length - 3} more` : ''),
    })));

    const idle = new Map();
    for (const r of rows) {
      if (Number(r.avail) > 0 && !(Number(r.o_qty) > 0)) {
        let s = idle.get(r.product);
        if (!s) idle.set(r.product, (s = { n: 0, outlets: new Set() }));
        s.n++;
        s.outlets.add(r.retailer_id);
      }
    }
    this.upsell.setRows(prods.map((p) => {
      const s = idle.get(p.key);
      return { ...p, idle: s?.n || 0, outletsIdle: s?.outlets.size || 0, idlePct: p.available ? ((s?.n || 0) / p.available) * 100 : null };
    }));

    // Stock movement - only shown when the API actually carries quantities.
    const hasStock = rows.some((r) => Number(r.i_qty) || Number(r.c_qty) || Number(r.inward_qty));
    const host = el.querySelector('[data-stock]');
    if (hasStock && !this.stockMounted) {
      host.innerHTML = card({ title: 'Stock movement by SKU', sub: 'Quantities reported during audits', body: '<div data-stocktbl></div>', flush: true });
      this.stock = new DataTable(host.querySelector('[data-stocktbl]'), {
        title: 'stock-movement', sort: 'iQty',
        columns: [
          { key: 'key', label: 'SKU' },
          { key: 'iQty', label: 'I qty', type: 'num', hint: 'Sum of i_qty' },
          { key: 'cQty', label: 'C qty', type: 'num', hint: 'Sum of c_qty' },
          { key: 'inward', label: 'Inward qty', type: 'num' },
          { key: 'orderQty', label: 'Order qty', type: 'num' },
          { key: 'availPct', label: 'Availability', type: 'meter' },
        ],
      });
      this.stockMounted = true;
    }
    if (!hasStock && this.stockMounted) {
      host.innerHTML = '';
      this.stockMounted = false;
    }
    if (this.stockMounted) this.stock.setRows(prods);
  },
};

// ============================== Pivot ==============================

const pivotPage = {
  title: 'Pivot builder',
  sub: 'Slice any metric by any two dimensions',
  mount(el, ctx) {
    const dims = A.DIMENSIONS.filter((d) => hasField(ctx, d.key));
    this.row = 'region';
    this.col = 'category';
    this.metric = 'availPct';
    const opts = (sel, withNone) => `${withNone ? '<option value="">— none —</option>' : ''}${dims.map((d) => `<option value="${d.key}" ${d.key === sel ? 'selected' : ''}>${d.label}</option>`).join('')}`;
    el.innerHTML = card({
      title: 'Pivot',
      sub: 'Choose rows, columns and a metric. Rows without columns become a sortable table.',
      flush: true,
      body: `<div class="pivot-controls">
        <label>Rows <select class="input" data-p="row">${opts(this.row)}</select></label>
        <label>Columns <select class="input" data-p="col">${opts(this.col, true)}</select></label>
        <label>Metric <select class="input" data-p="metric">${A.METRICS.map((m) => `<option value="${m.key}" ${m.key === this.metric ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      </div><div data-out style="padding:0 16px 16px"></div><div data-tbl></div>`,
    });
    el.querySelectorAll('[data-p]').forEach((s) => s.addEventListener('change', () => {
      this[s.dataset.p] = s.value;
      this.update(el, ctx.current());
    }));
    bindCellTips(el);
    this.table = new DataTable(el.querySelector('[data-tbl]'), { title: 'pivot', columns: [{ key: 'key', label: 'Key' }] });
  },
  update(el, ctx) {
    const { rows } = ctx;
    const m = A.METRICS.find((x) => x.key === this.metric);
    const out = el.querySelector('[data-out]');
    const tbl = el.querySelector('[data-tbl]');
    if (this.col && this.col !== this.row) {
      tbl.hidden = true;
      out.hidden = false;
      const pv = A.pivot(rows, this.row, this.col);
      const colOrder = A.sortBy(A.groupBy(rows, this.col), 'checks').map((c) => c.key);
      pv.rows.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
      const isPct = m.fmt === 'pct';
      out.innerHTML = heatTable(pv.rows.slice(0, 200), colOrder, { metric: m.key, fmt: isPct ? 'pct' : 'num', rowLabel: A.DIMENSIONS.find((d) => d.key === this.row)?.label, maxCols: 30 });
    } else {
      tbl.hidden = false;
      out.hidden = true;
      this.table.setColumns([
        { key: 'key', label: A.DIMENSIONS.find((d) => d.key === this.row)?.label || 'Key' },
        ...A.METRICS.map((x) => ({ key: x.key, label: x.label, type: x.key === 'availPct' ? 'meter' : x.fmt })),
      ]);
      this.table.sort = this.metric;
      this.table.setRows(A.groupBy(rows, this.row));
    }
  },
};

// ============================== Explorer ==============================

const LABELS = {
  id: 'ID', product_id: 'Product ID', retailer_id: 'Retailer ID', session_id: 'Session', user_id: 'User ID', date: 'Date',
  i_qty: 'I qty', c_qty: 'C qty', f_qty: 'F qty', ms: 'MS', sos: 'SOS', o_qty: 'Order qty', avail: 'Avail', inward_qty: 'Inward qty',
  region: 'Region', cluster: 'Cluster', territory: 'Territory', team: 'Team', tl_name: 'TL', tl_code: 'TL code', pteam: 'RSM team',
  ptl_name: 'RSM', ptl_code: 'RSM code', salesman: 'Salesman', s_code: 'Rep code', o_code: 'Outlet code', o_name: 'Outlet',
  outlet_type: 'Outlet type', class: 'Class', street: 'Street', city: 'City', state: 'State', zip: 'PIN', prd_code: 'SKU code',
  product: 'Product', product_source: 'Source', family: 'Family', category: 'Category', brand: 'Brand', total_prog: 'Total',
};
const DEFAULT_COLS = ['date', 'o_name', 'outlet_type', 'salesman', 'region', 'cluster', 'product', 'category', 'brand', 'avail', 'o_qty', 'sos', 'ms'];

const explorer = {
  title: 'Data explorer',
  sub: 'Every raw row from the API, sortable and exportable',
  mount(el, ctx) {
    this.cols = new Set(DEFAULT_COLS.filter((c) => hasField(ctx, c)));
    el.innerHTML = card({
      title: 'Raw rows',
      sub: 'Respects every filter above',
      actions: '<div class="dd" data-colpick><button class="btn btn-sm" type="button">Columns</button></div>',
      body: '<div data-table></div>',
      flush: true,
    });
    const picker = el.querySelector('[data-colpick]');
    picker.querySelector('button').addEventListener('click', () => {
      const existing = picker.querySelector('.popover');
      if (existing) return existing.remove();
      const pop = document.createElement('div');
      pop.className = 'popover dd-pop';
      pop.style.left = 'auto';
      pop.style.right = '0';
      pop.innerHTML = `<div class="dd-list">${ctx.meta.columns.map((c) => `<label class="dd-opt"><input type="checkbox" value="${esc(c)}" ${this.cols.has(c) ? 'checked' : ''}><span class="lbl">${esc(LABELS[c] || c)}</span><span class="n">${esc(c)}</span></label>`).join('')}</div>`;
      pop.addEventListener('change', (e) => {
        if (e.target.checked) this.cols.add(e.target.value);
        else this.cols.delete(e.target.value);
        this.update(el, ctx.current());
      });
      picker.appendChild(pop);
      const close = (e) => {
        if (!picker.contains(e.target)) {
          pop.remove();
          document.removeEventListener('mousedown', close);
        }
      };
      document.addEventListener('mousedown', close);
    });
    this.table = new DataTable(el.querySelector('[data-table]'), { title: 'raw-data', sort: 'date', pageSize: 50, columns: [{ key: 'date', label: 'Date' }] });
  },
  update(el, ctx) {
    const { rows, meta } = ctx;
    const ordered = meta.columns.filter((c) => this.cols.has(c));
    const numeric = new Set(ordered.filter((c) => rows.slice(0, 200).every((r) => r[c] == null || typeof r[c] === 'number')));
    this.table.setColumns(ordered.map((c) => ({ key: c, label: LABELS[c] || c, type: c === 'date' ? 'date' : numeric.has(c) && !/_id$|^id$|zip/.test(c) ? 'num' : 'text' })));
    this.table.setRows(rows);
  },
};

export const PAGES = { overview, availability, outlets, team, geography, opportunities, pivot: pivotPage, explorer };
