import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Defaults to the row's `key` field. */
  render?: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, onRowClick, empty }: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  return (
    // Phones: rows stay on one line and the table scrolls sideways inside its card.
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {columns.map((c) => (
                <th key={c.key} className={cn('whitespace-nowrap px-4 py-3 text-left font-semibold text-text-muted max-sm:px-3', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-text-muted">
                  {empty ?? 'No records'}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onRowClick?.(row)}
                  className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-muted/50')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 text-text max-sm:whitespace-nowrap max-sm:px-3', c.className)}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
