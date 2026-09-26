import { post, withIdempotency } from './client';
import type { RazorpayClientPayload } from './payments';

export interface RescheduleMoney { feeMinor: number; fareDiffMinor: number; amountDueMinor: number; refundMinor: number }
export type RescheduleResult =
  | ({ status: 'rescheduled'; amendmentId: string } & RescheduleMoney)
  | ({ status: 'payment_required'; payment: { intentId: string; clientPayload: RazorpayClientPayload; amountMinor: number } } & RescheduleMoney);

/** Staff changes to a booking. `key` is made once per dialog so a double click changes it once. */
export const amendmentsApi = {
  changeSeats: (bookingId: string, newSeatNumbers: string[], key: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/change-seats`, { newSeatNumbers }, withIdempotency(key)),
  changePoints: (bookingId: string, body: { fromStopId?: string; toStopId?: string }, key: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/change-points`, body, withIdempotency(key)),
  correctName: (bookingId: string, seatNumber: string, fullName: string, key: string) =>
    post<{ amendmentId: string }>(`/v1/bookings/${bookingId}/correct-name`, { seatNumber, fullName }, withIdempotency(key)),
  reschedule: (bookingId: string, body: { newTripId: string; newFromStopId: string; newToStopId: string; newSeatNumbers: string[] }, key: string) =>
    post<RescheduleResult>(`/v1/bookings/${bookingId}/reschedule`, body, withIdempotency(key)),
  /** Sandbox only: pay a booking-change amount as the customer would. */
  payChangeTest: (intentId: string, key: string) =>
    post<{ status: string }>(`/v1/payments/intents/${intentId}/charge-test`, { method: 'upi', vpa: 'success@ticketly' }, withIdempotency(key)),
  extendHold: (bookingId: string, releaseAt: string, key: string) =>
    post<{ holdExpiresAt: string }>(`/v1/bookings/${bookingId}/extend-hold`, { releaseAt }, withIdempotency(key)),
  noShow: (ticketId: string) => post<{ ok: boolean }>(`/v1/bookings/tickets/${ticketId}/no-show`, {}),
};
