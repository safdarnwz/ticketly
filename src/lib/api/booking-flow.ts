import { get, post } from './client';

export interface City { id: string; name: string; state?: string }
export interface Stop { id: string; name: string; cityId?: string }
export interface SeatCell { seatNumber: string; available: boolean; seatType?: string; deck?: number; row?: number; col?: number }

export interface Quote {
  quoteId: string;
  totalMinor: number;
  currency: string;
  expiresAt: string;
  perSeat?: unknown;
  /** Per-seat breakdown — populated when seatNumbers were sent (the normal case now that seats are picked before quoting). Different seats can have different totals when a per-seat-number fare override applies. */
  seatFares?: { seatNumber: string; totalMinor: number }[];
}

export const flowApi = {
  searchCities: (q: string) => get<{ items: City[] }>(`/v1/master-data/cities/search?q=${encodeURIComponent(q)}`),
  cityBySlug: (slug: string) => get<City>(`/v1/master-data/cities/by-slug/${encodeURIComponent(slug)}`),
  stopsInCity: (cityId: string) => get<{ items: Stop[] }>(`/v1/master-data/cities/${cityId}/stops`),
  trip: (tripId: string) => get<{ trip: any; stops: any[] }>(`/v1/scheduling/trips/${tripId}`),
  availability: (tripId: string, fromStopId: string, toStopId: string) =>
    get<{ available: number; total: number; seats: SeatCell[] }>(
      `/v1/scheduling/trips/${tripId}/availability?from=${fromStopId}&to=${toStopId}`,
    ),
  quote: (input: { tripId: string; fromStopId: string; toStopId: string; seatType?: string; seatNumbers?: string[]; seatCount?: number; couponCode?: string }) =>
    post<Quote>('/v1/pricing/quote', input),
};
