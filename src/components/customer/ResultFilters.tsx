import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import type { SearchResult } from '@/lib/api/types';
import { DEPARTURE_SLOTS, EMPTY_FILTERS, activeFilterCount, type FilterState } from '@/lib/search-filters';
import { SEAT_TYPE_LABEL, cn } from '@/lib/utils';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition',
        on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The results sidebar. Options come from the unfiltered results (every seat
 * type and amenity actually on offer for this search), so nothing is shown
 * that could only ever match zero buses.
 */
export function ResultFilters({ value, onChange, facets, showHeading = true }: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  facets: SearchResult[];
  showHeading?: boolean;
}) {
  const seatTypes = [...new Set(facets.flatMap((t) => t.seatTypes))].sort();
  const amenities = [...new Map(facets.flatMap((t) => t.amenities).map((a) => [a.code, a])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const prices = facets.map((t) => t.fromPriceMinor / 100);
  const lo = prices.length ? Math.floor(Math.min(...prices)) : 0;
  const hi = prices.length ? Math.ceil(Math.max(...prices)) : 0;

  // Price inputs apply on blur / Enter, so typing "1500" doesn't search for 1, 15, 150…
  const [minText, setMinText] = useState(value.minPrice?.toString() ?? '');
  const [maxText, setMaxText] = useState(value.maxPrice?.toString() ?? '');
  const [priceError, setPriceError] = useState('');
  useEffect(() => { setMinText(value.minPrice?.toString() ?? ''); setMaxText(value.maxPrice?.toString() ?? ''); }, [value.minPrice, value.maxPrice]);

  const applyPrice = () => {
    const parse = (t: string) => (t.trim() === '' ? undefined : Number(t));
    const min = parse(minText);
    const max = parse(maxText);
    if ((min !== undefined && (!Number.isFinite(min) || min < 0)) || (max !== undefined && (!Number.isFinite(max) || max < 0))) {
      setPriceError('Enter amounts in rupees');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setPriceError('Minimum is more than maximum');
      return;
    }
    setPriceError('');
    if (min !== value.minPrice || max !== value.maxPrice) onChange({ ...value, minPrice: min, maxPrice: max });
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const count = activeFilterCount(value);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex items-center justify-between">
        {showHeading ? <span className="font-semibold text-text">Filters</span> : <span />}
        {count > 0 && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <X className="h-3 w-3" /> Clear all ({count})
          </button>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-text-muted">Departure</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {DEPARTURE_SLOTS.map((s) => (
            <Chip key={s.key} on={value.slot === s.key} onClick={() => onChange({ ...value, slot: value.slot === s.key ? undefined : s.key })}>
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </Chip>
          ))}
        </div>
      </section>

      {seatTypes.length > 1 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-text-muted">Seat type</h3>
          <div className="flex flex-wrap gap-1.5">
            {seatTypes.map((t) => (
              <Chip key={t} on={value.seatTypes.includes(t)} onClick={() => onChange({ ...value, seatTypes: toggle(value.seatTypes, t) })}>
                {SEAT_TYPE_LABEL[t] ?? t}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold text-text-muted">Price (₹)</h3>
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={minText}
            onChange={(e) => setMinText(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            placeholder={lo ? String(lo) : 'Min'}
            aria-label="Minimum price"
            className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm focus-ring"
          />
          <span className="text-text-muted">–</span>
          <input
            inputMode="numeric"
            value={maxText}
            onChange={(e) => setMaxText(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === 'Enter' && applyPrice()}
            placeholder={hi ? String(hi) : 'Max'}
            aria-label="Maximum price"
            className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm focus-ring"
          />
        </div>
        {priceError && <p className="mt-1 text-xs text-danger">{priceError}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-text-muted">Rating</h3>
        <div className="flex gap-1.5">
          {[3, 4, 4.5].map((r) => (
            <Chip key={r} on={value.minRating === r} onClick={() => onChange({ ...value, minRating: value.minRating === r ? undefined : r })}>
              ★ {r}+
            </Chip>
          ))}
        </div>
      </section>

      {amenities.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-text-muted">Amenities</h3>
          <div className="flex flex-col gap-1.5">
            {amenities.map((a) => (
              <label key={a.code} className="flex cursor-pointer items-center gap-2 text-text">
                <input
                  type="checkbox"
                  checked={value.amenities.includes(a.code)}
                  onChange={() => onChange({ ...value, amenities: toggle(value.amenities, a.code) })}
                  className="h-4 w-4 rounded accent-[var(--yb-color-primary)]"
                />
                {a.name}
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
