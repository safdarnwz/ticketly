import { get, post, withIdempotency } from './client';

export interface AltAccountDetails { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string }

// Refunds
export type RefundStatus = 'initiated' | 'processing' | 'settled' | 'failed' | 'cancelled' | 'manual';
export interface BookingRefund { id: string; amountMinor: number; currency: string; status: RefundStatus; destination: 'source' | 'alternate_account'; failureReason: string | null; payoutReference: string | null; createdAt: string }
export interface RefundQueueRow {
  id: string; bookingId: string; pnr: string; contactPhone: string | null; amountMinor: number; currency: string;
  status: RefundStatus; destination: 'source' | 'alternate_account'; failureReason: string | null; attempts: number;
  accountHolder: string | null; accountMasked: string | null; ifsc: string | null; bankName: string | null;
  payoutReference: string | null; paidAt: string | null; createdAt: string; updatedAt: string;
}
export type RefundQueue = 'action' | 'processing' | 'done' | 'all';

export const refundsApi = {
  /** A booking's refunds, and how much of what was paid can still be refunded. */
  forBooking: (bookingId: string) => get<{ refunds: BookingRefund[]; currency: string; capturedMinor: number; refundedMinor: number; refundableMinor: number }>(`/v1/bookings/${bookingId}/refunds`),
  queue: (queue: RefundQueue, opts: { pnr?: string; cursor?: string } = {}) => {
    const q = new URLSearchParams({ queue });
    if (opts.pnr) q.set('pnr', opts.pnr);
    if (opts.cursor) q.set('cursor', opts.cursor);
    return get<{ items: RefundQueueRow[]; needsAction: number; hasMore: boolean; nextCursor: string | null }>(`/v1/refunds?${q}`);
  },
  payout: (id: string) => get<AltAccountDetails & { bankName: string | null }>(`/v1/refunds/${id}/payout`),
  /** `key` stays the same for a retry of the same refund, so it is never paid twice. */
  initiate: (bookingId: string, amountMinor: number, destination: 'source' | 'alternate_account', key: string, altAccountDetails?: AltAccountDetails) =>
    post<{ refundId: string; status: string }>('/v1/refunds', { bookingId, amountMinor, destination, altAccountDetails }, withIdempotency(key)),
  retry: (id: string) => post<{ status: string }>(`/v1/refunds/${id}/retry`, {}, withIdempotency(`refund-retry-${id}-${Date.now()}`)),
  /** Paid outside the gateway (bank transfer), with the transfer's UTR. */
  markPaid: (id: string, reference: string) => post<{ ok: boolean }>(`/v1/refunds/${id}/manual`, { reference }, withIdempotency(`refund-paid-${id}`)),
};

// Departure control (Part 13)
export const dcsApi = {
  getChart: (tripId: string) => get<unknown>(`/v1/trips/${tripId}/chart`),
  chart: (tripId: string, body: { spotSalesCount?: number; spotSalesCashMinor?: number; expectedSpotFareMinor?: number }) =>
    post<unknown>(`/v1/trips/${tripId}/chart`, body, withIdempotency(`chart-${tripId}-${JSON.stringify(body)}`)),
};

// Fraud (Part 14)
export interface RiskSignals {
  accountAgeDays: number; bookingsLast24h: number; amountMinor: number; seatCount: number;
  emailDisposable: boolean; paymentMethodNew: boolean; billingCountryMismatch: boolean; nightBooking: boolean;
}
export interface RiskResult {
  score: number; band: 'low' | 'medium' | 'high'; decision: 'allow' | 'review' | 'deny';
  reasons: { code: string; points: number }[];
  assessmentId?: string;
}
export const fraudApi = {
  assess: (signals: RiskSignals, bookingId?: string) => post<RiskResult>('/v1/fraud/assess', { signals, bookingId }),
  reviewQueue: () => get<{ assessments: { id: string; pnr: string; contactPhone: string | null; score: number; band: string; decision: string; reasons: { code: string; points: number }[]; createdAt: string }[] }>('/v1/fraud/review-queue'),
  forBooking: (bookingId: string) => get<unknown>(`/v1/fraud/bookings/${bookingId}`),
};
