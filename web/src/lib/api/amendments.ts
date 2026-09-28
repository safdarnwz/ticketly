import { get, post, withIdempotency } from './client';
import type { RazorpayClientPayload } from './payments';

export interface RescheduleMoney { feeMinor: number; fareDiffMinor: number; amountDueMinor: number; refundMinor: number }
export type RescheduleResult =
  | ({ status: 'quote'; newTotalMinor: number } & RescheduleMoney)
  | ({ status: 'rescheduled'; amendmentId: string } & RescheduleMoney)
  | ({ status: 'payment_required'; payment: { intentId: string; clientPayload: RazorpayClientPayload; amountMinor: number } } & RescheduleMoney);

export interface RescheduleTarget { newTripId: string; newFromStopId: string; newToStopId: string; newSeatNumbers: string[] }
export interface RescheduleOption { tripId: string; routeName: string; departsAt: string; boardsAt: string; dropsAt: string; freeSeats: number }
const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

/**
 * Changes to a booking. Staff need nothing else; the customer who booked it
 * signs in or gives the booking `mobile`. `key` is made once per dialog so a
 * double click changes it once.
 */
export const amendmentsApi = {
  changeSeats: (bookingId: string, newSeatNumbers: string[], key: string, mobile?: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/change-seats`, { newSeatNumbers, mobile }, withIdempotency(key)),
  changePoints: (bookingId: string, body: { fromStopId?: string; toStopId?: string }, key: string, mobile?: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/change-points`, { ...body, mobile }, withIdempotency(key)),
  correctName: (bookingId: string, seatNumber: string, fullName: string, key: string, mobile?: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/correct-name`, { seatNumber, fullName, mobile }, withIdempotency(key)),
  reschedule: (bookingId: string, body: RescheduleTarget, key: string, mobile?: string) =>
    post<RescheduleResult>(`/v1/bookings/${bookingId}/reschedule`, { ...body, mobile }, withIdempotency(key)),
  /** Buses on a day (YYYY-MM-DD) through this booking's boarding and drop points. */
  rescheduleOptions: (bookingId: string, date: string, mobile?: string) =>
    get<{ fromStopId: string; toStopId: string; seatsNeeded: number; trips: RescheduleOption[] }>(`/v1/bookings/${bookingId}/reschedule-options?${qs({ date, mobile })}`),
  /** What moving would cost now — nothing changes. */
  rescheduleQuote: (bookingId: string, t: RescheduleTarget, mobile?: string) =>
    get<Extract<RescheduleResult, { status: 'quote' }>>(`/v1/bookings/${bookingId}/reschedule-quote?${qs({ newTripId: t.newTripId, newFromStopId: t.newFromStopId, newToStopId: t.newToStopId, seats: t.newSeatNumbers.join(','), mobile })}`),
  /** Sandbox only: pay a booking-change amount as the customer would. */
  payChangeTest: (intentId: string, key: string) =>
    post<{ status: string }>(`/v1/payments/intents/${intentId}/charge-test`, { method: 'upi', vpa: 'success@ticketly' }, withIdempotency(key)),
  extendHold: (bookingId: string, releaseAt: string, key: string) =>
    post<{ holdExpiresAt: string }>(`/v1/bookings/${bookingId}/extend-hold`, { releaseAt }, withIdempotency(key)),
  noShow: (ticketId: string) => post<{ ok: boolean }>(`/v1/bookings/tickets/${ticketId}/no-show`, {}),
};
