import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';

import type { TripFilter } from '@/lib/api/storefront';
import { slugifyCityName } from '@/lib/utils';

/** Departure windows a traveller thinks in; each maps to the backend's departAfter/departBefore. */
export const DEPARTURE_SLOTS = [
  { key: 'early', label: 'Before 6 am', icon: Sunrise, after: '00:00', before: '05:59' },
  { key: 'morning', label: '6 am – 12 pm', icon: Sun, after: '06:00', before: '11:59' },
  { key: 'afternoon', label: '12 pm – 6 pm', icon: Sunset, after: '12:00', before: '17:59' },
  { key: 'night', label: 'After 6 pm', icon: Moon, after: '18:00', before: '23:59' },
] as const;

export interface FilterState {
  slot?: string;
  seatTypes: string[];
  amenities: string[];
  /** Rupees, as typed. */
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
}

export const EMPTY_FILTERS: FilterState = { seatTypes: [], amenities: [] };

export function activeFilterCount(f: FilterState): number {
  return (f.slot ? 1 : 0) + f.seatTypes.length + f.amenities.length
    + (f.minPrice !== undefined || f.maxPrice !== undefined ? 1 : 0) + (f.minRating ? 1 : 0);
}

/** The filter the backend's POST /search understands. */
export function toApiFilter(f: FilterState): TripFilter | undefined {
  const slot = DEPARTURE_SLOTS.find((s) => s.key === f.slot);
  const out: TripFilter = {
    ...(slot ? { departAfter: slot.after, departBefore: slot.before } : {}),
    ...(f.seatTypes.length ? { seatTypes: f.seatTypes } : {}),
    ...(f.amenities.length ? { amenities: f.amenities } : {}),
    ...(f.minPrice !== undefined ? { minPriceMinor: Math.round(f.minPrice * 100) } : {}),
    ...(f.maxPrice !== undefined ? { maxPriceMinor: Math.round(f.maxPrice * 100) } : {}),
    ...(f.minRating ? { minRating: f.minRating } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Filters live in the URL so a filtered search can be shared or reloaded. */
export function filtersFromParams(p: URLSearchParams): FilterState {
  const num = (k: string) => {
    const v = p.get(k);
    const n = v === null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const list = (k: string) => (p.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const slot = p.get('dep') ?? undefined;
  const rating = num('rating');
  return {
    slot: DEPARTURE_SLOTS.some((s) => s.key === slot) ? slot : undefined,
    seatTypes: list('st'),
    amenities: list('am'),
    minPrice: num('minp'),
    maxPrice: num('maxp'),
    minRating: rating && rating <= 5 ? rating : undefined,
  };
}

export function writeFiltersToParams(p: URLSearchParams, f: FilterState): URLSearchParams {
  const next = new URLSearchParams(p);
  const set = (k: string, v: string | undefined) => (v ? next.set(k, v) : next.delete(k));
  set('dep', f.slot);
  set('st', f.seatTypes.join(','));
  set('am', f.amenities.join(','));
  set('minp', f.minPrice !== undefined ? String(f.minPrice) : undefined);
  set('maxp', f.maxPrice !== undefined ? String(f.maxPrice) : undefined);
  set('rating', f.minRating ? String(f.minRating) : undefined);
  return next;
}

/** The URL a search lands on — readable city slugs, never ids. */
export function resultsUrl(from: string, to: string, date: string, returnDate?: string): string {
  const p = new URLSearchParams({ from: slugifyCityName(from), to: slugifyCityName(to), date });
  if (returnDate) p.set('return', returnDate);
  return `/results?${p.toString()}`;
}
