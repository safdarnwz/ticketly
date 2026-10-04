'use strict';

// Flattens nested objects (config_json.inward_qty -> inward_qty), drops columns that are
// empty in every row, and ships the result column-wise to keep 5-second polling light.
function toColumnar(rows) {
  const flat = rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [nk, nv] of Object.entries(v)) out[nk in row ? `${k}.${nk}` : nk] = nv;
      } else {
        out[k] = v;
      }
    }
    return out;
  });
  const columns = [];
  const seen = new Set();
  for (const r of flat) {
    for (const k of Object.keys(r)) {
      if (seen.has(k)) continue;
      seen.add(k);
      columns.push(k);
    }
  }
  const used = columns.filter((c) => flat.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== ''));
  return { columns: used, rows: flat.map((r) => used.map((c) => (r[c] === undefined ? null : r[c]))) };
}

module.exports = { toColumnar };
