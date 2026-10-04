/* global Chart */
import { num, pct, dec, compact, esc } from './format.js';

const registry = new Map();
const FORMATS = { num, pct: (v) => pct(v), dec, compact };

export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const series = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(css);
export const seqRamp = () => ['--q1', '--q2', '--q3', '--q4', '--q5', '--q6', '--q7'].map(css);

// Color follows the entity, never its rank: once "Candid" is slot 1 it stays slot 1
// whatever filter is applied. Slots are seeded from the unfiltered dataset.
const slotMaps = new Map();
export function seedSlots(dim, orderedKeys) {
  const map = new Map();
  orderedKeys.slice(0, 7).forEach((k, i) => map.set(k, i));
  slotMaps.set(dim, map);
}
export function colorFor(dim, key) {
  if (key === 'Other') return css('--other');
  const idx = slotMaps.get(dim)?.get(key);
  return idx == null ? css('--other') : series()[idx];
}

function applyDefaults() {
  const ink2 = css('--ink-2');
  const ink3 = css('--ink-3');
  Chart.defaults.font.family = css('--font') || 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = ink3;
  Chart.defaults.borderColor = css('--grid');
  Chart.defaults.animation.duration = 350;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = css('--surface');
  tt.titleColor = css('--ink');
  tt.bodyColor = ink2;
  tt.borderColor = css('--line');
  tt.borderWidth = 1;
  tt.padding = 10;
  tt.cornerRadius = 6;
  tt.boxPadding = 4;
  tt.usePointStyle = true;
  tt.titleFont = { weight: '600', size: 12 };
  tt.bodyFont = { size: 12 };
  tt.caretSize = 0;
}

export function resetTheme() {
  for (const c of registry.values()) c.destroy();
  registry.clear();
  applyDefaults();
}

function upsert(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const existing = registry.get(id);
  if (existing && existing.canvas === canvas && existing.config.type === config.type) {
    existing.data.labels = config.data.labels;
    existing.data.datasets.forEach((ds, i) => {
      const next = config.data.datasets[i];
      if (next) Object.assign(ds, next);
    });
    existing.data.datasets.length = config.data.datasets.length;
    config.data.datasets.forEach((ds, i) => {
      if (!existing.data.datasets[i]) existing.data.datasets[i] = ds;
    });
    existing.options = config.options;
    existing.update();
    return existing;
  }
  if (existing) existing.destroy();
  const chart = new Chart(canvas, config);
  registry.set(id, chart);
  return chart;
}

export function destroyMissing() {
  for (const [id, c] of registry) {
    if (!document.body.contains(c.canvas)) {
      c.destroy();
      registry.delete(id);
    }
  }
}

function axis({ fmt = 'num', grid = true, max, min, title } = {}) {
  const f = FORMATS[fmt] || num;
  return {
    beginAtZero: true,
    min,
    max,
    border: { display: false },
    grid: { display: grid, color: css('--grid'), drawTicks: false },
    ticks: { padding: 8, maxTicksLimit: 6, callback: (v) => (fmt === 'pct' ? `${v}%` : fmt === 'num' ? compact(v) : f(v)) },
    title: title ? { display: true, text: title, color: css('--ink-3'), font: { size: 11.5 } } : undefined,
  };
}

function catAxis(maxChars = 18) {
  return {
    border: { color: css('--line-strong') },
    grid: { display: false },
    ticks: {
      autoSkip: true,
      maxRotation: 0,
      padding: 6,
      callback(value) {
        const label = String(this.getLabelForValue(value));
        return label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
      },
    },
  };
}

/** Bar chart. One series -> one colour unless `colors` is given (entity colours). */
export function bar(id, { labels, values, horizontal = false, fmt = 'num', color, colors, onClick, max, tooltipExtra, labelChars }) {
  const f = FORMATS[fmt] || num;
  const fill = colors || color || css('--s1');
  return upsert(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: fill,
        hoverBackgroundColor: fill,
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: horizontal ? 18 : 34,
        categoryPercentage: 0.78,
        barPercentage: 0.9,
      }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      layout: { padding: { right: horizontal ? 8 : 0 } },
      scales: horizontal
        ? { x: axis({ fmt, max }), y: catAxis(labelChars || 24) }
        : { x: catAxis(labelChars || 14), y: axis({ fmt, max }) },
      onClick: onClick ? (_e, els) => els[0] && onClick(labels[els[0].index], els[0].index) : undefined,
      onHover: onClick ? (e, els) => (e.native.target.style.cursor = els.length ? 'pointer' : 'default') : undefined,
      plugins: {
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (ctx) => f(ctx.raw),
            afterLabel: tooltipExtra ? (ctx) => tooltipExtra(ctx.dataIndex) : undefined,
          },
        },
      },
    },
  });
}

export function line(id, { labels, datasets, fmt = 'num', max, area = false }) {
  const f = FORMATS[fmt] || num;
  return upsert(id, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: area ? hexAlpha(d.color, 0.1) : d.color,
        fill: area ? 'origin' : false,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: labels.length > 20 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: d.color,
        pointBorderColor: css('--surface'),
        pointBorderWidth: 2,
        spanGaps: true,
      })),
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: catAxis(10), y: axis({ fmt, max }) },
      plugins: {
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${f(ctx.raw)}` } },
      },
    },
  });
}

export function donut(id, { labels, values, colors, fmt = 'num', onClick }) {
  const f = FORMATS[fmt] || num;
  const total = values.reduce((s, v) => s + v, 0) || 1;
  return upsert(id, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: css('--surface'), borderWidth: 2, hoverOffset: 4 }],
    },
    options: {
      cutout: '68%',
      onClick: onClick ? (_e, els) => els[0] && onClick(labels[els[0].index]) : undefined,
      onHover: onClick ? (e, els) => (e.native.target.style.cursor = els.length ? 'pointer' : 'default') : undefined,
      plugins: {
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${f(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)` } },
      },
    },
  });
}

export function scatter(id, { points, xLabel, yLabel, xFmt = 'num', yFmt = 'pct', color, onClick }) {
  const fx = FORMATS[xFmt];
  const fy = FORMATS[yFmt];
  return upsert(id, {
    type: 'scatter',
    data: {
      datasets: [{
        data: points,
        backgroundColor: hexAlpha(color || css('--s1'), 0.75),
        borderColor: css('--surface'),
        borderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointHitRadius: 10,
      }],
    },
    options: {
      scales: {
        x: { ...axis({ fmt: xFmt, title: xLabel }), border: { color: css('--line-strong') } },
        y: axis({ fmt: yFmt, max: yFmt === 'pct' ? 100 : undefined, title: yLabel }),
      },
      onClick: onClick ? (_e, els) => els[0] && onClick(points[els[0].index]) : undefined,
      plugins: {
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => items[0]?.raw?.label || '',
            label: (ctx) => [`${xLabel}: ${fx(ctx.raw.x)}`, `${yLabel}: ${fy(ctx.raw.y)}`],
          },
        },
      },
    },
  });
}

export function legendHtml(labels, colors, values, fmt = 'num') {
  const f = FORMATS[fmt] || num;
  const total = values ? values.reduce((s, v) => s + v, 0) || 1 : 1;
  return labels
    .map((l, i) => `<span><i style="background:${colors[i]}"></i>${esc(l)}${values ? ` <b>${f(values[i])}</b> <em style="font-style:normal;color:var(--ink-3)">${((values[i] / total) * 100).toFixed(0)}%</em>` : ''}</span>`)
    .join('');
}

export function hexAlpha(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Sequential cell colour for heatmaps (0-100). Returns [background, text]. */
export function heatColor(value) {
  if (value == null) return ['transparent', css('--ink-3')];
  const ramp = seqRamp();
  const idx = Math.min(ramp.length - 1, Math.floor((value / 100) * ramp.length));
  const dark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const lightText = dark ? idx < 5 : idx >= 3;
  return [ramp[idx], lightText ? '#ffffff' : '#0b0b0b'];
}

applyDefaults();
