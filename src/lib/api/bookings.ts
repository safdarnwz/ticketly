import { get, post, withIdempotency } from './client';
import type { Booking, Ticket } from './types';

export interface HoldInput {
  quoteId: string;
  seatNumbers: string[];
  passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[];
  contactEmail?: string;
  contactPhone?: string;
}

export const bookingsApi = {
  /** Staff/ops lookup by PNR alone — no customer phone-number needed, unlike the customer-self-service by-pnr endpoint. */
  byPnrStaff: (pnr: string) => get<{ booking: Booking }>(`/v1/bookings/by-pnr-staff/${encodeURIComponent(pnr)}`),
  hold: (input: HoldInput) =>
    post<{ bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number }>(
      '/v1/bookings/hold', input, withIdempotency(`hold-${input.quoteId}`),
    ),
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
  /** Every booking for a phone number, across every operator. */
  mine: (mobile: string) => get<{ bookings: Booking[] }>(`/v1/bookings/mine?mobile=${encodeURIComponent(mobile)}`),

  // Tickets (Part 15)
  tickets: (bookingId: string) => get<{ pnr: string; tickets: Ticket[] }>(`/v1/bookings/${bookingId}/tickets`),
  ticketHtmlUrl: (bookingId: string) => `/api/v1/bookings/${bookingId}/ticket.html`,
  verifyTicket: (token: string) => post<{ valid: boolean; payload: unknown }>('/v1/tickets/verify', { token }),

  // Invoices (Part 13)
  invoices: (bookingId: string) => get<{ invoices: { id: string; kind: string; invoiceNumber: string; totalMinor: number; issuedAt: string }[] }>(`/v1/bookings/${bookingId}/invoices`),
};
