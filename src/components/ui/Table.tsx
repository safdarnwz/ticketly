import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Defaults to the row's `key` field. */
  render?: (row: T) => ReactNode;
  className?: string;
}

/**
 * Rows of data that never scroll sideways or spill out of their box. When the
 * space it is given fits the table (cells wrap inside their column), it is a
 * table; when it does not — a phone, a narrow column, a tablet with the
 * sidebar open — each row becomes a short list of "label — value" lines with
 * the row's actions (columns without a header) underneath. The width is
 * measured before paint, so the layout does not jump.
 */
export function Table<T>({
  columns,
  rows,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [stacked, setStacked] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  // The width the table needed the last time it was shown.
  const needed = useRef(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => {
      const t = table.current;
      if (t) {
        needed.current = t.scrollWidth;
        if (t.scrollWidth > el.clientWidth + 1) setStacked(true);
      } else if (needed.current && el.clientWidth >= needed.current) setStacked(false);
      else if (!needed.current && window.innerWidth >= 768) setStacked(false);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stacked, rows, columns]);

  const cell = (c: Column<T>, row: T) => (c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? ''));
  const labelled = columns.filter((c) => c.header !== '' && c.header != null);
  const actions = columns.filter((c) => c.header === '' || c.header == null);

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
        {empty ?? 'No records'}
      </div>
    );
  }

  return (
    <div ref={box} className="overflow-hidden rounded-card border border-border bg-surface">
      {!stacked ? (
        <table ref={table} className="w-full table-auto text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-3 text-left font-medium text-text-muted', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-muted/50')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-top text-text [overflow-wrap:anywhere]', c.className)}>
                    {cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, i) => (
            <li
              key={i}
              onClick={() => onRowClick?.(row)}
              className={cn('flex flex-col gap-1.5 px-4 py-3 text-sm', onRowClick && 'cursor-pointer active:bg-surface-muted/50')}
            >
              {labelled.map((c) => (
                <div key={c.key} className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] items-start gap-3">
                  <span className="text-text-muted">{c.header}</span>
                  <span className="min-w-0 text-text [overflow-wrap:anywhere]">{cell(c, row)}</span>
                </div>
              ))}
              {actions.length > 0 && (
                <div className="flex min-w-0 flex-wrap gap-2 pt-1 [&>*]:max-w-full">
                  {actions.map((c) => (
                    <div key={c.key} className="min-w-0 max-w-full [&_.justify-end]:justify-start [&_div]:flex-wrap">
                      {cell(c, row)}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
