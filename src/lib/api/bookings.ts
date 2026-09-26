import { get, post, withIdempotency } from './client';
import type { Booking, TicketsResponse } from './types';

export interface HoldInput {
  quoteId: string;
  seatNumbers: string[];
  passengers: {
    seatNumber: string;
    fullName: string;
    age?: number;
    gender?: string;
    category?: string;
    idProof?: string;
  }[];
  contactEmail?: string;
  contactPhone?: string;
  /** Staff only: a man on a ladies seat, with the reason (logged). */
  ladiesSeatOverrideReason?: string;
  /** 'backoffice' for staff counter sales (needs booking:create); storefront omits it. */
  channel?: 'direct_web' | 'direct_app' | 'backoffice';
}

/** A booking as the operator's bookings list shows it. */
export interface StaffBookingRow {
  id: string; pnr: string; status: string;
  /** A customer is paying for it right now. */
  liveHold: boolean; holdExpiresAt: string | null;
  totalMinor: number; paidMinor: number; seatCount: number;
  contactPhone: string | null; contactEmail: string | null; channel: string;
  createdAt: string; confirmedAt: string | null; cancelledAt: string | null;
  tripId: string; journeyDate: string; departsAt: string; routeName: string;
  fromName: string | null; toName: string | null; leadPassenger: string | null; seats: string[];
  /** The travel agent who sold it, if any. */
  agentName?: string | null;
  /** Seats whose passenger did not turn up. */
  noShowSeats?: string[];
}
export type StaffBookingStatus = 'live' | 'confirmed' | 'cancelled' | 'expired' | 'completed';
export interface StaffBookingFilters {
  pnr?: string; mobile?: string; ticket?: string;
  from?: string; to?: string; dateBasis?: 'booked' | 'journey';
  status?: StaffBookingStatus; channel?: string; tripId?: string; agentId?: string; noShow?: boolean; branchId?: string;
}

export const bookingsApi = {
  /** The operator's bookings, newest first (default: booked today). */
  list: (f: StaffBookingFilters, cursor?: string, limit = 50) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, cursor, limit })) if (v !== undefined && v !== '') p.set(k, String(v));
    return get<{ from: string | null; to: string | null; items: StaffBookingRow[]; hasMore: boolean; nextCursor: string | null }>(`/v1/bookings/search?${p}`);
  },
  /** Staff/ops lookup by PNR alone — no customer phone-number needed, unlike the customer-self-service by-pnr endpoint. */
  byPnrStaff: (pnr: string) => get<{
    booking: Booking;
    detail: StaffBookingRow | null;
    passengers: { seatNumber: string; fullName: string; age: number | null; gender: string | null }[];
    /** Latest status of each document email: eticket / invoice. */
    emails: Partial<Record<'eticket' | 'invoice', string>>;
  }>(`/v1/bookings/by-pnr-staff/${encodeURIComponent(pnr)}`),
  hold: (input: HoldInput) =>
    post<{ bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number }>(
      '/v1/bookings/hold', input, withIdempotency(`hold-${input.quoteId}`),
    ),
  /** Phone booking (staff): keep the seats for a caller until `releaseAt`; they pay later. */
  phoneBook: (input: HoldInput & { releaseAt: string }) =>
    post<{ bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number }>(
      '/v1/bookings/phone', input, withIdempotency(`phone-${input.quoteId}`),
    ),
  /** Free an unpaid hold now (the customer went back to change seats). The holder only: signed in, or the booking mobile. */
  releaseHold: (bookingId: string, mobile?: string) =>
    post<{ released: boolean }>(`/v1/bookings/${bookingId}/release-hold`, { mobile }),
  confirm: (bookingId: string, paidMinor: number, reference?: string) =>
    post<{ pnr: string; tickets: { seatNumber: string; boardingCode: string }[] }>(
      `/v1/bookings/${bookingId}/confirm`, { paidMinor, reference }, withIdempotency(`confirm-${bookingId}`),
    ),
  /** Staff: cancel the whole booking. A booking is cancelled once, so the key is the booking. */
  cancel: (bookingId: string, reason?: string) =>
    post<{ refundMinor: number; refundPct: number }>(`/v1/bookings/${bookingId}/cancel`, { reason }, withIdempotency(`cancel-${bookingId}`)),
  /** Cancel some seats; the rest stay confirmed. Staff need nothing else; a customer gives the booking mobile. */
  cancelSeats: (bookingId: string, seatNumbers: string[], reason?: string, mobile?: string) =>
    post<{ refundMinor: number; refundPct: number; remainingSeats: number }>(
      `/v1/bookings/${bookingId}/cancel-seats`, { seatNumbers, reason, mobile },
      withIdempotency(`cancel-seats-${bookingId}-${[...seatNumbers].sort().join('.')}`),
    ),
  /** What cancelling the whole booking would refund right now. */
  refundPreview: (bookingId: string) =>
    get<{ refundMinor: number; refundPct: number; cancellable: boolean; reason?: string }>(`/v1/bookings/${bookingId}/refund-preview`),
  /** Staff: email the e-ticket again (optionally to another address). */
  resendTicket: (bookingId: string, email?: string) =>
    post<{ sent: boolean }>(`/v1/bookings/${bookingId}/tickets/resend`, { email: email || undefined }),
  /** Customer self-service cancel — mobile proves ownership, no login needed. */
  selfCancel: (bookingId: string, mobile: string, reason?: string) =>
    post<{ refundMinor: number; refundPct: number }>(`/v1/bookings/${bookingId}/self-cancel`, { mobile, reason },
      // Deterministic on the booking — a booking can only be meaningfully
      // cancelled once, so any retry of "cancel THIS booking" (including a
      // rapid double-click before the button disables) naturally dedupes.
      withIdempotency(`self-cancel-${bookingId}`)),
  // Cross-tenant lookup — mobile is REQUIRED (PNR alone is only unique per
  // operator, and it also proves the caller owns this booking). Response
  // shape is { booking, seats }, NOT a bare Booking.
  getByPnr: (pnr: string, mobile: string) =>
    get<{ booking: Booking; seats: string[] }>(`/v1/bookings/by-pnr/${encodeURIComponent(pnr)}?mobile=${encodeURIComponent(mobile)}`),
  /** The signed-in customer's own bookings. */
  mine: () => get<{ bookings: Booking[] }>('/v1/bookings/mine'),

  // Tickets (Part 15)
  /** Staff and the booking's own signed-in customer need nothing else; a guest proves it with the booking's mobile. */
  tickets: (bookingId: string, mobile?: string) =>
    get<TicketsResponse>(`/v1/bookings/${bookingId}/tickets${mobile ? `?mobile=${encodeURIComponent(mobile)}` : ''}`),
  /** The printable e-ticket, fetched with the caller's credentials (a plain link would carry none). */
  ticketHtml: (bookingId: string, mobile?: string) =>
    get<string>(`/v1/bookings/${bookingId}/ticket.html${mobile ? `?mobile=${encodeURIComponent(mobile)}` : ''}`, { responseType: 'text' }),
  verifyTicket: (token: string) => post<{ valid: boolean; payload: unknown }>('/v1/tickets/verify', { token }),

  // Invoices (Part 13)
  invoices: (bookingId: string) => get<{ invoices: { id: string; kind: string; invoiceNumber: string; totalMinor: number; issuedAt: string }[] }>(`/v1/bookings/${bookingId}/invoices`),
};
