import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * How a column's text reads:
 * - `key` — the row's identifier (PNR, invoice, registration): heaviest weight.
 * - `strong` — the row's name (passenger, operator, route): medium weight.
 * - `figure` — money: heavy, right-aligned, digits line up.
 * - `count` — plain numbers: normal weight, right-aligned, digits line up.
 * - `muted` — dates, times, secondary facts.
 * - `note` — free text someone wrote (reason, note, error): italic.
 */
export type ColumnLook = 'key' | 'strong' | 'figure' | 'count' | 'muted' | 'note';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Defaults to the row's `key` field. */
  render?: (row: T) => ReactNode;
  className?: string;
  look?: ColumnLook;
  /**
   * When the columns do not fit side by side, this column moves under the
   * column with this key, as a second line (PNR → passenger underneath,
   * mobile → email, status → channel).
   */
  under?: string;
  /** Left out only when the table is still too tight after merging; the row's own page has it. */
  optional?: boolean;
}

const LOOK: Record<ColumnLook, string> = {
  key: 'font-bold text-text',
  strong: 'font-medium text-text',
  figure: 'text-right font-bold tabular-nums text-text',
  count: 'text-right tabular-nums text-text',
  muted: 'text-text-muted',
  note: 'italic text-text-muted',
};
const RIGHT: ColumnLook[] = ['figure', 'count'];

// Tighter tables give their cells less side padding.
const PAD = ['px-4', 'px-3', 'px-2.5', 'px-2'] as const;

/**
 * 0: every column on its own · 1: related columns stacked in one · 2: optional
 * columns left out too · 3: what is left pairs up, two values to a column.
 */
type Level = 0 | 1 | 2 | 3;

/**
 * Always a table — never cards, never a sideways scroll. When there is room each
 * value has its own column; when the space is tight (a phone, a tablet with the
 * sidebar, a narrow panel) related values share a column as two lines, and if it
 * is tighter still the optional columns step out. The width is measured before
 * paint, so the table does not jump.
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
  const [level, setLevel] = useState<Level>(0);
  // The width each level needed when it did not fit — to step back once there is room.
  const needed = useRef<number[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => {
      const t = table.current;
      if (!t) return;
      const room = el.clientWidth;
      if (t.offsetWidth > room + 1 && level < 3) {
        needed.current[level] = t.offsetWidth;
        setLevel((level + 1) as Level);
      } else if (level > 0 && (needed.current[level - 1] ?? Infinity) <= room) {
        setLevel((level - 1) as Level);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [level, rows, columns]);

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
        {empty ?? 'No records'}
      </div>
    );
  }

  const keys = new Set(columns.map((c) => c.key));
  const dropped = (c: Column<T>) => level >= 2 && !!c.optional;
  const moved = (c: Column<T>) => level >= 1 && !!c.under && keys.has(c.under);
  const beneath = (host: string) => columns.filter((c) => c.under === host && moved(c) && !dropped(c));
  // Each shown column with the values stacked under it.
  let layout = columns.filter((c) => !dropped(c) && !moved(c)).map((c) => ({ c, subs: beneath(c.key) }));
  if (level >= 3) {
    const paired: typeof layout = [];
    let host: (typeof layout)[number] | null = null;
    for (const item of layout) {
      if (host && item.c.header !== '' && host.c.header !== '') {
        host.subs = [...host.subs, item.c, ...item.subs];
        host = null;
      } else {
        paired.push(item);
        host = item;
      }
    }
    layout = paired;
  }
  const value = (c: Column<T>, row: T): ReactNode =>
    c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '');
  const right = (c: Column<T>) => !!c.look && RIGHT.includes(c.look);

  return (
    <div ref={box} className="overflow-hidden rounded-card border border-border bg-surface">
      <table ref={table} className="w-full table-auto text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted/60">
            {layout.map(({ c, subs: all }) => {
              const subs = all.filter((s) => s.header !== '' && s.header != null);
              return (
                <th
                  key={c.key}
                  className={cn(
                    'py-3 text-left align-bottom font-medium text-text-muted',
                    PAD[level],
                    level < 2 && 'whitespace-nowrap',
                    right(c) && 'text-right',
                    c.className,
                  )}
                >
                  {c.header}
                  {subs.length > 0 && (
                    <span className="block text-xs font-normal">
                      {subs.map((s, i) => (
                        <Fragment key={s.key}>
                          {i > 0 && ' · '}
                          {s.header}
                        </Fragment>
                      ))}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b border-border last:border-0',
                onRowClick && 'cursor-pointer hover:bg-surface-muted/50',
              )}
            >
              {layout.map(({ c, subs }) => (
                <td
                  key={c.key}
                  className={cn(
                    'py-3 align-top text-text [overflow-wrap:break-word]',
                    PAD[level],
                    c.look && LOOK[c.look],
                    level >= 2 && '[overflow-wrap:anywhere]',
                    c.header === '' && '[&_div]:flex-wrap',
                    c.className,
                  )}
                >
                  {value(c, row)}
                  {subs.map((s) => {
                    const v = value(s, row);
                    if (v == null || v === '' || v === false) return null;
                    return (
                      <div
                        key={s.key}
                        className={cn(
                          'mt-0.5 text-xs font-normal text-text-muted',
                          s.look === 'note' && 'italic',
                          s.look === 'figure' && 'font-medium tabular-nums',
                          s.look === 'count' && 'tabular-nums',
                        )}
                      >
                        {v}
                      </div>
                    );
                  })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
