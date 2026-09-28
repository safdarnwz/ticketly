import { get, post } from './client';

/** A customer of this operator — keyed by their account (booked signed in) or their mobile (guest). */
export interface Customer {
  key: string; customerId: string | null; name: string | null; phone: string | null; email: string | null;
  bookings: number; trips: number; cancelled: number; spentMinor: number;
  firstBookedAt: string; lastBookedAt: string; lastJourneyDate: string | null;
  frequent: boolean; blocked: boolean;
}
export interface CustomerBooking {
  id: string; pnr: string; status: string; seatCount: number; totalMinor: number; paidMinor: number;
  journeyDate: string | null; routeName: string | null; channel: string; createdAt: string;
}
export interface CustomerDetail extends Customer {
  block: { id: string; reason: string; blockedAt: string; blockedByName: string | null } | null;
  history: CustomerBooking[];
}
export type CustomerFilter = 'all' | 'frequent' | 'blocked';

export const crmApi = {
  list: (opts: { q?: string; filter: CustomerFilter; page: number }) => {
    const q = new URLSearchParams({ filter: opts.filter, page: String(opts.page) });
    if (opts.q) q.set('q', opts.q);
    return get<{ items: Customer[]; page: number; hasMore: boolean }>(`/v1/customers?${q}`);
  },
  profile: (key: string) => get<CustomerDetail>(`/v1/customers/${encodeURIComponent(key)}`),
  /** Stops new bookings with this operator, by account and mobile. */
  block: (key: string, reason: string) => post<{ ok: boolean }>(`/v1/customers/${encodeURIComponent(key)}/block`, { reason }),
  unblock: (key: string) => post<{ ok: boolean }>(`/v1/customers/${encodeURIComponent(key)}/unblock`, {}),
};
