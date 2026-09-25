import { get, post, del, withIdempotency } from './client';

export interface PromotionRate {
  id: string;
  billingCycle: 'daily' | 'weekly' | 'monthly';
  isMultiRoute: boolean;
  priceMinor: number;
  currency: string;
}

export interface RoutePromotion {
  id: string;
  routeId: string;
  groupId: string;
  billingCycle: 'daily' | 'weekly' | 'monthly' | null;
  priceMinor: number;
  currency: string;
  startsAt: string;
  endsAt: string;
  status: 'pending_payment' | 'active' | 'paused' | 'expired' | 'cancelled';
  autoRenew: boolean;
  createdAt: string;
  pausedAt: string | null;
  routeName?: string;
}

export interface PromotionQuote {
  days: number;
  perRouteMinor: number;
  totalMinor: number;
  currency: string;
  breakdown: { months: number; weeks: number; days: number };
}

export const promotionsApi = {
  // Super-admin only — view AND set the platform-wide rate card
  rates: () => get<{ rates: PromotionRate[] }>('/v1/admin/promotions/rates'),
  setRate: (input: { billingCycle: 'daily' | 'weekly' | 'monthly'; isMultiRoute: boolean; priceMinor: number }) =>
    post<{ ok: boolean }>('/v1/admin/promotions/rates', input),

  // Operator — read-only view of the same rate card, so an operator can see
  // pricing before purchasing (they can never set it, hence the separate,
  // non-admin, ROUTE_MANAGE-gated endpoint).
  ratesView: () => get<{ rates: PromotionRate[] }>('/v1/promotions/rates'),

  // Operator
  /** The exact price the purchase will charge — the server's own computation. */
  quote: (routeCount: number, startDate: string, endDate: string) =>
    get<PromotionQuote>(`/v1/promotions/quote?routeCount=${routeCount}&startDate=${startDate}&endDate=${endDate}`),
  /** `key` stays the same for a retry of the same purchase, so it is never charged twice. */
  purchase: (input: { routeIds: string[]; startDate: string; endDate: string; autoRenew: boolean }, key: string) =>
    post<{ groupId: string; promotionIds: string[]; totalMinor: number; currency: string; days: number }>('/v1/promotions', input, withIdempotency(key)),
  list: (status?: string) => get<{ promotions: RoutePromotion[] }>(`/v1/promotions${status ? `?status=${status}` : ''}`),
  cancel: (id: string) => del<{ adjustedMinor: number }>(`/v1/promotions/${id}`),
  pause: (id: string) => post<{ status: 'paused' }>(`/v1/promotions/${id}/pause`, {}),
  resume: (id: string) => post<{ status: 'active'; endsAt: string }>(`/v1/promotions/${id}/resume`, {}),
};
