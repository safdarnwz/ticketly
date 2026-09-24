import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Storefront result filtering & sorting
 * ============================================================================
 *
 * The raw trip-search output (Part 6) is refined here into what a storefront
 * shows: filtered by the traveller's constraints (price band, departure window,
 * seat type, amenities, operator rating, seats needed) and sorted by their
 * chosen key. Pure and deterministic — no I/O — so the exact behaviour of every
 * filter and tie-break is unit-testable, and the same function runs on the
 * server and (if ever needed) the client.
 *
 * Departure-time filtering uses the wall-clock HH:mm embedded in the ISO
 * timestamp, which is what a traveller means by "leaving after 18:00".
 */

export interface FilterableTrip {
  departsAt: string;   // ISO 8601
  arrivesAt: string;   // ISO 8601
  durationMin: number;
  fromPriceMinor: number;
  availableSeats: number;
  seatTypes?: string[];
  amenities?: string[];
  operatorRating?: number; // 0–5
}

export interface TripFilter {
  minPriceMinor?: number;
  maxPriceMinor?: number;
  /** Inclusive HH:mm lower bound on departure wall-clock time. */
  departAfter?: string;
  /** Inclusive HH:mm upper bound on departure wall-clock time. */
  departBefore?: string;
  /** Any-match: keep a trip offering at least one of these seat types. */
  seatTypes?: string[];
  /** All-match: keep a trip offering every one of these amenities. */
  amenities?: string[];
  minRating?: number;
  minSeats?: number;
}

export type SortKey = 'price' | 'departure' | 'duration' | 'rating';
export type SortDir = 'asc' | 'desc';

/** Minutes-since-midnight from an ISO timestamp's HH:mm (0–1439), or null. */
function minuteOfDay(iso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseHhMm(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid time '${hhmm}', expected HH:mm`);
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) throw new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid time '${hhmm}'`);
  return h * 60 + min;
}

export function matchesFilter<T extends FilterableTrip>(trip: T, filter: TripFilter): boolean {
  if (filter.minPriceMinor !== undefined && trip.fromPriceMinor < filter.minPriceMinor) return false;
  if (filter.maxPriceMinor !== undefined && trip.fromPriceMinor > filter.maxPriceMinor) return false;
  if (filter.minSeats !== undefined && trip.availableSeats < filter.minSeats) return false;
  if (filter.minRating !== undefined && (trip.operatorRating ?? 0) < filter.minRating) return false;

  if (filter.departAfter !== undefined || filter.departBefore !== undefined) {
    const dep = minuteOfDay(trip.departsAt);
    if (dep === null) return false;
    if (filter.departAfter !== undefined && dep < parseHhMm(filter.departAfter)) return false;
    if (filter.departBefore !== undefined && dep > parseHhMm(filter.departBefore)) return false;
  }

  if (filter.seatTypes?.length) {
    const offered = new Set(trip.seatTypes ?? []);
    if (!filter.seatTypes.some((t) => offered.has(t))) return false;
  }
  if (filter.amenities?.length) {
    const offered = new Set(trip.amenities ?? []);
    if (!filter.amenities.every((a) => offered.has(a))) return false;
  }
  return true;
}

function sortValue(trip: FilterableTrip, key: SortKey): number {
  switch (key) {
    case 'price': return trip.fromPriceMinor;
    case 'departure': return minuteOfDay(trip.departsAt) ?? Number.MAX_SAFE_INTEGER;
    case 'duration': return trip.durationMin;
    case 'rating': return trip.operatorRating ?? 0;
  }
}

/**
 * Filter then sort. The sort is stable within equal keys (preserves the input
 * order, which is departure-time from search), and `rating` defaults to
 * descending (best first) since that's what a traveller expects.
 */
export function filterAndSort<T extends FilterableTrip>(
  trips: T[],
  filter: TripFilter = {},
  sort: SortKey = 'departure',
  dir?: SortDir,
): T[] {
  const effectiveDir: SortDir = dir ?? (sort === 'rating' ? 'desc' : 'asc');
  const kept = trips.filter((t) => matchesFilter(t, filter));
  const factor = effectiveDir === 'asc' ? 1 : -1;
  return kept
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const d = (sortValue(a.t, sort) - sortValue(b.t, sort)) * factor;
      return d !== 0 ? d : a.i - b.i; // stable tie-break
    })
    .map((x) => x.t);
}
