/**
 * Read a CSV file (as Excel saves it) into one record per row, keyed by the
 * header. Handles quoted cells with commas, quotes and line breaks, CRLF
 * endings and Excel's byte-order mark. Blank rows are skipped; blank cells are
 * left out of the record ("not given", not empty text).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel's byte-order mark
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return [];
  const cols = header.map((h) => h.trim());
  return body.map((vals) => {
    const rec: Record<string, string> = {};
    cols.forEach((col, i) => { const v = (vals[i] ?? '').trim(); if (col && v !== '') rec[col] = v; });
    return rec;
  });
}
