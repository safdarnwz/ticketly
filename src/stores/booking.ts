import { create } from 'zustand';

import { configureBookingTenant } from '@/lib/api/client';
import type { Quote } from '@/lib/api/booking-flow';
import type { SearchResult } from '@/lib/api/types';
import { todayLocal } from '@/lib/utils';

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
  /** Round trip: the return leg still to book after this one (shown on the confirmation page). */
  pendingReturn?: { date: string; fromLabel: string; toLabel: string };

  setSearch: (p: Partial<Pick<BookingState, 'originCityId' | 'originLabel' | 'destCityId' | 'destLabel' | 'journeyDate'>>) => void;
  selectTrip: (trip: SearchResult, fromStopId: string, toStopId: string) => void;
  setSeats: (seats: string[]) => void;
  setQuote: (q: Quote) => void;
  setPassengers: (p: PassengerDraft[]) => void;
  setContact: (email: string, phone: string) => void;
  setConfirmed: (bookingId: string, pnr: string) => void;
  setViewedBookingTenant: (tenantId: string | undefined) => void;
  setPendingReturn: (r: BookingState['pendingReturn']) => void;
  reset: () => void;
}


export const useBooking = create<BookingState>((set) => ({
  originCityId: '', originLabel: '', destCityId: '', destLabel: '', journeyDate: todayLocal(),
  seatNumbers: [], passengers: [], contactEmail: '', contactPhone: '',

  setSearch: (p) => set(p),
  selectTrip: (trip, fromStopId, toStopId) => set({ trip, fromStopId, toStopId, seatNumbers: [], quote: undefined }),
  setSeats: (seatNumbers) => set({ seatNumbers }),
  setQuote: (quote) => set({ quote }),
  setPassengers: (passengers) => set({ passengers }),
  setContact: (contactEmail, contactPhone) => set({ contactEmail, contactPhone }),
  setConfirmed: (bookingId, pnr) => set({ bookingId, pnr }),
  setViewedBookingTenant: (viewedBookingTenantId) => set({ viewedBookingTenantId }),
  setPendingReturn: (pendingReturn) => set({ pendingReturn }),
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
