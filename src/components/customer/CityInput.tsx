import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

import { flowApi, type City } from '@/lib/api/booking-flow';

/** A debounced city autocomplete backed by the public city-search endpoint. */
export function CityInput({ label, value, onSelect }: {
  label: string;
  value: string;
  onSelect: (city: City) => void;
}) {
  const [q, setQ] = useState(value);
  const [items, setItems] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await flowApi.searchCities(q.trim());
        setItems(res.items ?? []);
      } catch { setItems([]); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative flex-1" ref={box}>
      <label className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="City"
          className="h-12 w-full rounded-input border border-border bg-surface pl-9 pr-3 text-sm text-text focus-ring"
        />
      </div>
      {open && items.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-dropdown">
          {items.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setQ(c.name); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface-muted"
            >
              <MapPin className="h-3.5 w-3.5 text-text-muted" />
              <span>{c.name}</span>
              {c.state && <span className="text-xs text-text-muted">{c.state}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
