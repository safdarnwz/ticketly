import { get, post, withIdempotency } from './client';

/** A travel agent's own account and bookings (the API resolves the agent from the login). */
export interface AgentMe {
  id: string; code: string; name: string; contactName: string | null; contactPhone: string; contactEmail: string | null; city: string | null;
  status: 'pending' | 'active' | 'suspended' | 'rejected'; statusReason: string | null;
  billingMode: 'prepaid' | 'postpaid'; commissionPct: number; creditLimitMinor: number; balanceMinor: number;
  lowBalanceAlertMinor: number; spendableMinor: number; lowBalance: boolean;
  currentCommission: { pct: number; source: 'agent_slab' | 'operator_slab' | 'flat'; monthSalesMinor: number };
  operator: { name: string; phone: string | null; email: string } | null;
}
export interface AgentBookingRow {
  id: string; pnr: string; status: string; totalMinor: number; currency: string; seatCount: number; contactPhone: string;
  createdAt: string; journeyDate: string; departsAt: string; routeName: string; commissionMinor: number;
}
export interface AgentBookingDetail {
  booking: { id: string; pnr: string; tripId: string; fromSeq: number; toSeq: number; status: string; seatCount: number; currency: string; totalMinor: number; paidMinor: number; contactPhone: string; contactEmail: string | null };
  passengers: { seatNumber: string; fullName: string; age: number | null; gender: string | null }[];
  tickets: { id: string; seatNumber: string }[];
  journey: { routeName: string; departsAt: string; arrivesAt: string; boardingStop: string | null; droppingStop: string | null; commissionMinor: number } | null;
}
export interface AgentLedgerRow { id: string; kind: string; amountMinor: number; balanceAfterMinor: number; bookingId: string | null; pnr: string | null; reference: string | null; note: string | null; createdAt: string }
export interface AgentStatement {
  agent: { id: string; code: string; name: string; billingMode: string; creditLimitMinor: number; paymentTermsDays: number };
  period: { from: string; to: string };
  openingBalanceMinor: number; salesMinor: number; refundsMinor: number; commissionMinor: number; receivedMinor: number;
  adjustmentsMinor: number; closingBalanceMinor: number; amountDueMinor: number;
  bookings: { pnr?: string; [k: string]: unknown }[];
}

export const agentPortalApi = {
  me: () => get<AgentMe>('/v1/agent-portal/me'),
  bookings: (period?: { from: string; to: string }) =>
    get<{ items: AgentBookingRow[] }>(`/v1/agent-portal/bookings${period ? `?from=${period.from}&to=${period.to}` : ''}`),
  booking: (id: string) => get<AgentBookingDetail>(`/v1/agent-portal/bookings/${id}`),
  ledger: (from?: string, to?: string) => get<{ items: AgentLedgerRow[] }>(`/v1/agent-portal/ledger${from && to ? `?from=${from}&to=${to}` : ''}`),
  statement: (from: string, to: string) => get<AgentStatement>(`/v1/agent-portal/statement?from=${from}&to=${to}`),
  /** Sell seats from the agent's account; `key` is made once per attempt so a double click books once. */
  book: (body: { quoteId: string; seatNumbers: string[]; passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[]; contactPhone: string; contactEmail?: string }, key: string) =>
    post<{ bookingId: string; pnr: string; totalMinor: number; commissionMinor: number; balanceMinor: number }>('/v1/agent-portal/bookings', body, withIdempotency(key)),
  cancel: (id: string, body: { reason?: string; seatNumbers?: string[] }, key: string) =>
    post<{ refundMinor: number; refundPct?: number; remainingSeats?: number; [k: string]: unknown }>(`/v1/agent-portal/bookings/${id}/cancel`, body, withIdempotency(key)),
  /** The same changes staff make, on the agent's own bookings. */
  changeSeats: (bookingId: string, newSeatNumbers: string[], key: string) =>
    post<{ amendmentId: string }>(`/v1/agent-portal/bookings/${bookingId}/change-seats`, { newSeatNumbers }, withIdempotency(key)),
  changePoints: (bookingId: string, body: { fromStopId?: string; toStopId?: string }, key: string) =>
    post<{ amendmentId: string }>(`/v1/agent-portal/bookings/${bookingId}/change-points`, body, withIdempotency(key)),
  correctName: (bookingId: string, seatNumber: string, fullName: string, key: string) =>
    post<{ amendmentId: string }>(`/v1/agent-portal/bookings/${bookingId}/correct-name`, { seatNumber, fullName }, withIdempotency(key)),
};
