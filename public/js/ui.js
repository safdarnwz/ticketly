import { esc } from './format.js';

export function card({ id = '', title, sub = '', body = '', actions = '', flush = false, cls = '' }) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    <div class="card-head"><div><div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub" data-sub>${sub}</div>` : ''}</div>${actions}</div>
    <div class="card-body ${flush ? 'flush' : ''}">${body}</div>
  </section>`;
}

export const canvas = (id, size = '') => `<div class="chart-box ${size}"><canvas id="${id}" role="img"></canvas></div>`;

export function kpi({ label, value, unit = '', foot = '', title = '' }) {
  return `<div class="kpi" title="${esc(title)}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}${unit ? `<small>${unit}</small>` : ''}</div>
    <div class="kpi-foot">${foot || '&nbsp;'}</div>
  </div>`;
}

/** Delta chip. `goodWhenUp=false` for metrics where a drop is good (e.g. OOS). */
export function delta(curr, prev, { pts = false, goodWhenUp = true, label = '' } = {}) {
  if (curr == null || prev == null || (!pts && prev === 0)) return '';
  const diff = pts ? curr - prev : ((curr - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(diff)) return '';
  const flat = Math.abs(diff) < 0.05;
  const up = diff > 0;
  const good = flat ? null : up === goodWhenUp;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(diff).toFixed(1)}${pts ? ' pts' : '%'}</span>${label ? ` <span>${esc(label)}</span>` : ''}`;
}

export function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map((o) => `<button type="button" data-v="${esc(o.key)}" class="${o.key === value ? 'on' : ''}">${esc(o.label)}</button>`).join('')}</div>`;
}

export function onSeg(root, name, fn) {
  root.querySelector(`[data-seg="${name}"]`)?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}

export function setHtml(root, sel, html) {
  const el = root.querySelector(sel);
  if (el) el.innerHTML = html;
}

export function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const tip = () => document.getElementById('cellTip');
export function bindCellTips(root) {
  root.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('[data-tip]');
    const t = tip();
    if (!cell) {
      t.hidden = true;
      return;
    }
    t.innerHTML = cell.dataset.tip;
    t.hidden = false;
    const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
    const y = Math.min(window.innerHeight - t.offsetHeight - 12, e.clientY + 14);
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  });
  root.addEventListener('mouseleave', () => (tip().hidden = true));
}
