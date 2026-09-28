import { useRef } from 'react';
import { CalendarDays } from 'lucide-react';

import { addDaysIso, cn } from '@/lib/utils';

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const parts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { weekday: WEEKDAY.format(d), day: d.getUTCDate(), month: MONTH.format(d) };
};

/**
 * "Pick a date" — six days in a grid that always fits the width (no sideways
 * scrolling), the chosen day filled. The last tile opens the calendar for any
 * other allowed date; a later date chosen there starts the six days.
 */
export function DateStrip({ label, value, min, max, days = 6, onChange, error }: {
  label: string;
  value: string;
  min: string;
  max: string;
  days?: number;
  onChange: (iso: string) => void;
  error?: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  // Start at the first allowed day, or at the chosen day once it is beyond the first six.
  const start = value && value >= min && value > addDaysIso(min, days - 1) && value <= max ? value : min;
  const list: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysIso(start, i);
    if (d > max) break;
    list.push(d);
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-medium text-text">{label}</span>
        {value && <span className="text-xs text-text-muted">{parts(value).weekday}, {parts(value).day} {parts(value).month}</span>}
      </div>
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {list.map((d) => {
          const p = parts(d);
          const on = d === value;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={`${p.weekday} ${p.day} ${p.month}`}
              onClick={() => onChange(d)}
              className={cn(
                'flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left',
                on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text hover:bg-surface-muted',
              )}
            >
              <span className={cn('w-full truncate text-xs', on ? 'text-primary-fg/80' : 'text-text-muted')}>{p.weekday.slice(0, 3)}</span>
              <span className="text-base font-medium leading-none">{p.day} <span className="text-xs font-normal">{p.month}</span></span>
            </button>
          );
        })}
        <label className="relative flex min-w-0 cursor-pointer flex-col items-start justify-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-2 text-text-muted hover:bg-surface-muted">
          <CalendarDays className="h-4 w-4" />
          <span className="text-xs">Other date</span>
          <input
            ref={picker}
            type="date"
            aria-label={`${label}: other date`}
            value={value}
            min={min}
            max={max}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            onClick={() => { try { picker.current?.showPicker(); } catch { /* not supported */ } }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
