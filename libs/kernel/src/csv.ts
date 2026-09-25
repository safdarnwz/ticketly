/**
 * CSV for exports. One implementation so every export quotes the same way
 * and is safe to open in a spreadsheet.
 */

/** Quote a field only if it needs it (comma, quote, CR or LF). */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A text cell a spreadsheet would run as a formula (=, +, -, @, tab, CR at the
 * start) gets a leading apostrophe — user-typed names and notes end up in
 * these files. Numbers are written as they are.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof Date) text = value.toISOString();
  else text = JSON.stringify(value) ?? '';
  return csvField(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
}

/** Header row + one row per record, columns in the given order. */
export function toCsv<T extends Record<string, unknown>>(
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join(
    '\n',
  );
}
