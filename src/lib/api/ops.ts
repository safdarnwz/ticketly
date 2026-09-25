import { get, post, withIdempotency } from './client';

export interface AltAccountDetails { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string }

// Refunds (Part 13)
export const refundsApi = {
  forBooking: (bookingId: string) => get<{ refunds: { amountMinor: number; currency: string; status: string; destination: string }[] }>(`/v1/bookings/${bookingId}/refunds`),
  initiate: (bookingId: string, amountMinor: number, destination: 'source' | 'alternate_account', altAccountDetails?: AltAccountDetails) =>
    post<{ refundId: string; status: string }>('/v1/refunds', { bookingId, amountMinor, destination, altAccountDetails }, withIdempotency(`refund-${bookingId}-${amountMinor}-${destination}`)),
  retry: (id: string) => post<{ status: string }>(`/v1/refunds/${id}/retry`, {}, withIdempotency(`refund-retry-${id}`)),
  manual: (id: string) => post<{ ok: boolean }>(`/v1/refunds/${id}/manual`, {}, withIdempotency(`refund-manual-${id}`)),
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
