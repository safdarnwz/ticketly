import { get, post, withIdempotency } from './client';
import { idempotencyKey } from '@/lib/utils';

export interface City { id: string; name: string; state?: string }
export interface Stop { id: string; name: string; cityId?: string }
/** One seat on the seat map: where it sits on the layout and whether it is free on this segment. */
export interface SeatCell {
  seatNumber: string;
  seatType: 'seater' | 'sleeper' | 'semi_sleeper' | string;
  available: boolean;
  ladiesOnly: boolean;
  accessible: boolean;
  deck: number;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  position: 'front' | 'aisle' | 'window' | null;
}

export interface SeatMapResponse {
  tripStatus: string;
  available: number;
  total: number;
  layout: { decks: number; rows: number; columns: number };
  seats: SeatCell[];
}

export interface TripStop {
  sequence: number;
  stopId: string;
  name: string | null;
  arrivesAt: string;
  departsAt: string;
  canBoard: boolean;
  canAlight: boolean;
  /** Operator's extra per seat (paise, before GST) for boarding / getting off here. */
  boardChargeMinor?: number;
  dropChargeMinor?: number;
}

/** What the operator lets a passenger carry free, and what more costs. */
export interface LuggagePolicy { freeKg: number; freePieces: number; extraPerKgMinor: number | null; note: string }

export interface TripDetail {
  trip: { id: string; routeId: string; journeyDate: string; departsAt: string; arrivesAt: string; status: string; totalSeats: number };
  stops: TripStop[];
  /** Null until the operator publishes one. */
  luggage?: LuggagePolicy | null;
}

export interface CheckoutConcession {
  category: 'child' | 'senior' | 'student' | 'defence' | 'disabled' | string;
  discountPct: number;
  minAge: number | null;
  maxAge: number | null;
  requiresIdProof: boolean;
  maxPerBooking: number | null;
}

export interface PassengerPolicy {
  adultAge: number;
  infantMaxAge: number;
  infantFeeMinor: number;
  allowUnaccompaniedMinors: boolean;
}

export interface Ancillary {
  id: string;
  code: string;
  name: string;
  kind: string;
  priceMinor: number;
  perPassenger: boolean;
}

export interface Quote {
  quoteId: string;
  totalMinor: number;
  /** Per-seat pickup / drop charges included (paise, before GST). */
  pointCharges?: { boardMinor: number; dropMinor: number };
  currency: string;
  expiresAt: string;
  /** One seat's price breakdown (base, taxes, discount, total). */
  perSeat?: {
    netFare: { amount: number };
    taxTotal: { amount: number };
    discount: { amount: number };
    total: { amount: number };
  };
  couponCode?: string | null;
  /** Per-seat breakdown — populated when seatNumbers were sent (the normal case now that seats are picked before quoting). Different seats can have different totals when a per-seat-number fare override applies. */
  seatFares?: { seatNumber: string; totalMinor: number }[];
}

/** A call about a specific operator's trip (connecting legs belong to different operators). */
const forTenant = (tenantId?: string) => (tenantId ? { headers: { 'X-Tenant-Id': tenantId } } : undefined);

export const flowApi = {
  searchCities: (q: string) => get<{ items: City[] }>(`/v1/master-data/cities/search?q=${encodeURIComponent(q)}`),
  cityBySlug: (slug: string) => get<City>(`/v1/master-data/cities/by-slug/${encodeURIComponent(slug)}`),
  stopsInCity: (cityId: string) => get<{ items: Stop[] }>(`/v1/master-data/cities/${cityId}/stops`),
  trip: (tripId: string, tenantId?: string) => get<TripDetail>(`/v1/scheduling/trips/${tripId}`, forTenant(tenantId)),
  /** The seat map (layout + seats) for a boarding → dropping segment. */
  availability: (tripId: string, fromStopId: string, toStopId: string, tenantId?: string) =>
    get<SeatMapResponse>(`/v1/scheduling/trips/${tripId}/availability?from=${fromStopId}&to=${toStopId}`, forTenant(tenantId)),
  /** Concessions (senior, student…) and age rules the chosen operator offers on that date. */
  concessions: (journeyDate?: string) =>
    get<{ concessions: CheckoutConcession[]; policy: PassengerPolicy; roundTripDiscountPct?: number }>(
      `/v1/concessions/checkout${journeyDate ? `?journeyDate=${journeyDate}` : ''}`,
    ),
  /** The operator's add-on catalogue (insurance, meals, luggage…). */
  ancillaries: () => get<{ items: Ancillary[] }>('/v1/me/ancillaries'),
  /** Set the held booking's add-ons (replaces any chosen before; [] removes them). */
  setAncillaries: (bookingId: string, items: { ancillaryId: string; quantity: number }[]) =>
    // A fresh key per change: the request replaces the whole set, so replaying an
    // earlier identical request (A → B → A) would answer A while B stays saved.
    post<{ totalMinor: number; bookingTotalMinor: number }>('/v1/me/ancillaries/attach', { bookingId, items }, withIdempotency(idempotencyKey(`addons-${bookingId}`))),
  quote: (input: { tripId: string; fromStopId: string; toStopId: string; seatType?: string; seatNumbers?: string[]; seatCount?: number; couponCode?: string }, tenantId?: string) =>
    post<Quote>('/v1/pricing/quote', input, forTenant(tenantId)),
};
