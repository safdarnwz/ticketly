import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, MapPin } from 'lucide-react';

import { flowApi, type City } from '@/lib/api/booking-flow';
import { cn } from '@/lib/utils';

/**
 * Debounced city autocomplete (public city search). Typing after a city was
 * chosen clears the choice (`onClear`), so a half-edited name can never be
 * searched with the previous city's id. Arrow keys + Enter pick a city.
 */
export function CityInput({ label, value, onSelect, onClear, error, placeholder = 'City', autoFocus, variant = 'field' }: {
  label: string;
  value: string;
  onSelect: (city: City) => void;
  onClear?: () => void;
  error?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** `journey`: the customer search look — a ring dot, a small label and a big borderless city name. */
  variant?: 'field' | 'journey';
}) {
  const [q, setQ] = useState(value);
  const [items, setItems] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || term === value) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await flowApi.searchCities(term);
        setItems(res.items ?? []);
        setFailed(false);
      } catch {
        setItems([]);
        setFailed(true);
      } finally {
        setLoading(false);
        setActive(0);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (c: City) => { onSelect(c); setQ(c.name); setOpen(false); };
  const shown = items.slice(0, 8);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || shown.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + shown.length) % shown.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const term = q.trim();
  const showNone = open && !loading && term.length >= 2 && term !== value && shown.length === 0;

  return (
    <div className="relative flex-1" ref={box}>
      {variant === 'journey' ? (
        <div className="flex items-start gap-3">
          <span className={cn('mt-1', label === 'From' ? 'dot-from' : 'dot-to')} aria-hidden />
          <div className="min-w-0 flex-1">
            <label htmlFor={`${listId}-input`} className="block text-[13px] text-text-muted">{label}</label>
            <div className="relative">
              <input
                id={`${listId}-input`}
                value={q}
                autoFocus={autoFocus}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                  if (value && e.target.value !== value) onClear?.();
                }}
                onFocus={(e) => { setOpen(true); e.target.select(); }}
                onKeyDown={onKey}
                placeholder={placeholder}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-invalid={Boolean(error)}
                autoComplete="off"
                className="w-full truncate border-0 bg-transparent p-0 pr-7 font-display text-[26px] leading-tight text-text outline-none placeholder:font-semibold placeholder:text-text-muted/60 sm:text-[28px]"
              />
              {loading && <Loader2 className="absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />}
            </div>
          </div>
        </div>
      ) : (
        <>
      <label htmlFor={`${listId}-input`} className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          id={`${listId}-input`}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value && e.target.value !== value) onClear?.();
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={Boolean(error)}
          className={cn(
            'h-12 w-full rounded-input border bg-surface pl-9 pr-9 text-sm text-text focus-ring',
            error ? 'border-danger' : 'border-border',
          )}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />}
      </div>
        </>
      )}
      {error && <p className={cn('mt-1 text-xs text-danger', variant === 'journey' && 'pl-6')} role="alert">{error}</p>}
      {open && shown.length > 0 && (
        <div id={listId} role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--yb-dropdown-radius)] bg-surface shadow-dropdown ring-1 ring-border">
          {shown.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text', i === active ? 'bg-surface-muted' : 'hover:bg-surface-muted')}
            >
              <MapPin className="h-3.5 w-3.5 text-text-muted" />
              <span>{c.name}</span>
              {c.state && <span className="text-xs text-text-muted">{c.state}</span>}
            </button>
          ))}
        </div>
      )}
      {showNone && (
        <div className="absolute z-30 mt-1 w-full rounded-[var(--yb-dropdown-radius)] bg-surface px-3 py-2 text-sm text-text-muted shadow-dropdown ring-1 ring-border">
          {failed ? 'Could not load cities — check your connection' : `No city matches “${term}”`}
        </div>
      )}
    </div>
  );
}
