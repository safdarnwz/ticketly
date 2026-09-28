import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  /** Names and times of the chosen boarding / dropping points (for summaries). */
  points?: { from: string; fromAt: string; to: string; toAt: string };
  seatType?: string;
  seatNumbers: string[];
  /** Selected seats that are ladies-only (the passenger must be female). */
  ladiesSeats?: string[];
  quote?: Quote;
  /** What the applied coupon takes off the quote (incl. GST), for the summary. */
  couponSavingMinor?: number;
  passengers: PassengerDraft[];
  contactEmail: string;
  contactPhone: string;
  bookingId?: string;
  pnr?: string;
  /** The seats are held (not yet paid) until holdExpiresAt. */
  hold?: {
    bookingId: string;
    pnr: string;
    holdExpiresAt: string;
    /** The booking total when held (fare after concessions). */
    totalMinor: number;
    /** Round-trip discount taken off this (return) booking. */
    roundTripDiscountMinor?: number;
    /** Add-ons chosen (id → quantity), what they cost with GST, and the total to pay now. */
    addons?: Record<string, number>;
    addonTotalMinor?: number;
    payableMinor?: number;
  };
  /** Set after a cross-tenant PNR lookup (AccountPage) so the follow-up
   *  ticket/invoice fetch for THAT booking still carries its operator. */
  viewedBookingTenantId?: string;
  /** Round trip: the return leg still to book after this one (shown on the confirmation page). */
  pendingReturn?: { date: string; fromLabel: string; toLabel: string };
  /** Booking the way back of a round trip: the onward booking (its operator gives a return discount). */
  returnOf?: { bookingId: string; tenantId: string; fromLabel: string; toLabel: string };

  setSearch: (p: Partial<Pick<BookingState, 'originCityId' | 'originLabel' | 'destCityId' | 'destLabel' | 'journeyDate'>>) => void;
  selectTrip: (trip: SearchResult, fromStopId: string, toStopId: string) => void;
  setSelection: (s: { points: BookingState['points']; seatType: string; seatNumbers: string[]; ladiesSeats: string[]; quote: Quote }) => void;
  setHold: (h: BookingState['hold']) => void;
  setSeats: (seats: string[]) => void;
  setQuote: (q: Quote) => void;
  setPassengers: (p: PassengerDraft[]) => void;
  setContact: (email: string, phone: string) => void;
  setConfirmed: (bookingId: string, pnr: string) => void;
  setViewedBookingTenant: (tenantId: string | undefined) => void;
  setPendingReturn: (r: BookingState['pendingReturn']) => void;
  setReturnOf: (r: BookingState['returnOf']) => void;
  reset: () => void;
}


// Kept for this browser tab (sessionStorage), so a refresh during checkout
// does not lose the held seats; a new tab starts clean.
export const useBooking = create<BookingState>()(persist((set) => ({
  originCityId: '', originLabel: '', destCityId: '', destLabel: '', journeyDate: todayLocal(),
  seatNumbers: [], passengers: [], contactEmail: '', contactPhone: '',

  setSearch: (p) => set(p),
  selectTrip: (trip, fromStopId, toStopId) => set({ trip, fromStopId, toStopId, seatNumbers: [], quote: undefined, hold: undefined }),
  setSelection: ({ points, seatType, seatNumbers, ladiesSeats, quote }) => set({ points, seatType, seatNumbers, ladiesSeats, quote, hold: undefined, couponSavingMinor: 0 }),
  setHold: (hold) => set({ hold }),
  setSeats: (seatNumbers) => set({ seatNumbers }),
  setQuote: (quote) => set({ quote }),
  setPassengers: (passengers) => set({ passengers }),
  setContact: (contactEmail, contactPhone) => set({ contactEmail, contactPhone }),
  setConfirmed: (bookingId, pnr) => set({ bookingId, pnr }),
  setViewedBookingTenant: (viewedBookingTenantId) => set({ viewedBookingTenantId }),
  setPendingReturn: (pendingReturn) => set({ pendingReturn }),
  setReturnOf: (returnOf) => set({ returnOf }),
  reset: () => set({ trip: undefined, seatNumbers: [], quote: undefined, passengers: [], bookingId: undefined, pnr: undefined, hold: undefined, points: undefined, seatType: undefined }),
}), {
  name: 'ticketly.booking',
  storage: createJSONStorage(() => sessionStorage),
}));

// Every call from trip-selection onward (detail, availability, quote, hold,
// confirm, ticket) must carry the CHOSEN operator — www.ticketly.com itself
// has no tenant bound. Falls back to `viewedBookingTenantId` for the
// PNR-lookup flow (AccountPage), which never went through `selectTrip`.
configureBookingTenant(() => {
  const s = useBooking.getState();
  return s.trip?.tenantId ?? s.viewedBookingTenantId ?? null;
});
