import { create } from 'zustand';

import { configureBookingTenant } from '@/lib/api/client';
import type { Quote } from '@/lib/api/booking-flow';
import type { SearchResult } from '@/lib/api/types';

export interface PassengerDraft { seatNumber: string; fullName: string; age?: number; gender?: string }

interface BookingState {
  // search
  originCityId: string; originLabel: string;
  destCityId: string; destLabel: string;
  journeyDate: string;
  // selection
  trip?: SearchResult;
  fromStopId?: string; toStopId?: string;
  seatNumbers: string[];
  quote?: Quote;
  passengers: PassengerDraft[];
  contactEmail: string;
  contactPhone: string;
  bookingId?: string;
  pnr?: string;
  /** Set after a cross-tenant PNR lookup (AccountPage) so the follow-up
   *  ticket/invoice fetch for THAT booking still carries its operator. */
  viewedBookingTenantId?: string;

  setSearch: (p: Partial<Pick<BookingState, 'originCityId' | 'originLabel' | 'destCityId' | 'destLabel' | 'journeyDate'>>) => void;
  selectTrip: (trip: SearchResult, fromStopId: string, toStopId: string) => void;
  setSeats: (seats: string[]) => void;
  setQuote: (q: Quote) => void;
  setPassengers: (p: PassengerDraft[]) => void;
  setContact: (email: string, phone: string) => void;
  setConfirmed: (bookingId: string, pnr: string) => void;
  setViewedBookingTenant: (tenantId: string | undefined) => void;
  reset: () => void;
}

const today = new Date().toISOString().slice(0, 10);

export const useBooking = create<BookingState>((set) => ({
  originCityId: '', originLabel: '', destCityId: '', destLabel: '', journeyDate: today,
  seatNumbers: [], passengers: [], contactEmail: '', contactPhone: '',

  setSearch: (p) => set(p),
  selectTrip: (trip, fromStopId, toStopId) => set({ trip, fromStopId, toStopId, seatNumbers: [], quote: undefined }),
  setSeats: (seatNumbers) => set({ seatNumbers }),
  setQuote: (quote) => set({ quote }),
  setPassengers: (passengers) => set({ passengers }),
  setContact: (contactEmail, contactPhone) => set({ contactEmail, contactPhone }),
  setConfirmed: (bookingId, pnr) => set({ bookingId, pnr }),
  setViewedBookingTenant: (viewedBookingTenantId) => set({ viewedBookingTenantId }),
  reset: () => set({ trip: undefined, seatNumbers: [], quote: undefined, passengers: [], bookingId: undefined, pnr: undefined }),
}));

// Every call from trip-selection onward (detail, availability, quote, hold,
// confirm, ticket) must carry the CHOSEN operator — www.ticketly.com itself
// has no tenant bound. Falls back to `viewedBookingTenantId` for the
// PNR-lookup flow (AccountPage), which never went through `selectTrip`.
configureBookingTenant(() => {
  const s = useBooking.getState();
  return s.trip?.tenantId ?? s.viewedBookingTenantId ?? null;
});
