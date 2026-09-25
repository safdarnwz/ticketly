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
  /** 'backoffice' for staff counter sales (needs booking:create); storefront omits it. */
  channel?: 'direct_web' | 'direct_app' | 'backoffice';
}

export const bookingsApi = {
  /** Staff/ops lookup by PNR alone — no customer phone-number needed, unlike the customer-self-service by-pnr endpoint. */
  byPnrStaff: (pnr: string) => get<{ booking: Booking }>(`/v1/bookings/by-pnr-staff/${encodeURIComponent(pnr)}`),
  hold: (input: HoldInput) =>
    post<{ bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number }>(
      '/v1/bookings/hold', input, withIdempotency(`hold-${input.quoteId}`),
    ),
  /** Free an unpaid hold now (the customer went back to change seats). The holder only: signed in, or the booking mobile. */
  releaseHold: (bookingId: string, mobile?: string) =>
    post<{ released: boolean }>(`/v1/bookings/${bookingId}/release-hold`, { mobile }),
  confirm: (bookingId: string, paidMinor: number, reference?: string) =>
    post<{ pnr: string; tickets: { seatNumber: string; boardingCode: string }[] }>(
      `/v1/bookings/${bookingId}/confirm`, { paidMinor, reference }, withIdempotency(`confirm-${bookingId}`),
    ),
  cancel: (bookingId: string, reason?: string) =>
    post<{ refundMinor: number; refundPct: number }>(`/v1/bookings/${bookingId}/cancel`, { reason }),
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
