import { useEffect, useRef } from 'react';
import { CalendarDays } from 'lucide-react';

import { addDaysIso, cn } from '@/lib/utils';

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const parts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { weekday: WEEKDAY.format(d), day: d.getUTCDate(), month: MONTH.format(d) };
};

/**
 * "Pick a date" — a row of day cards (weekday, big day number) that scrolls
 * sideways, the chosen day in the accent colour. The last card opens the
 * calendar for any other allowed date; a date chosen there joins the row.
 */
export function DateStrip({ label, value, min, max, days = 21, onChange, error }: {
  label: string;
  value: string;
  min: string;
  max: string;
  days?: number;
  onChange: (iso: string) => void;
  error?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const list: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysIso(min, i);
    if (d > max) break;
    list.push(d);
  }
  if (value && value >= min && value <= max && !list.includes(value)) list.push(value);

  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-lg text-text">{label}</span>
        {value && <span className="text-xs text-text-muted">{parts(value).weekday}, {parts(value).day} {parts(value).month}</span>}
      </div>
      <div ref={row} role="group" aria-label={label} className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2 pt-1">
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
                'flex h-[84px] w-[74px] shrink-0 flex-col items-start justify-between rounded-2xl px-2.5 py-2 text-left transition',
                on ? 'bg-accent text-white shadow-md' : 'bg-surface-muted text-text-muted hover:bg-border',
              )}
            >
              <span className={cn('w-full truncate text-[10px] font-semibold', on ? 'text-white/90' : '')}>{p.weekday}</span>
              <span className={cn('font-display text-[30px] leading-none', on ? 'text-white' : 'text-text-muted/70')}>{p.day}</span>
            </button>
          );
        })}
        <label className="relative flex h-[84px] w-[74px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-text-muted hover:bg-surface-muted">
          <CalendarDays className="h-5 w-5" />
          <span className="text-[11px] font-semibold">Other date</span>
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
