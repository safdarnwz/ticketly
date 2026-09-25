import { get, post, del } from './client';

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
  purchase: (input: { routeIds: string[]; startDate: string; endDate: string; autoRenew: boolean }) =>
    post<{ groupId: string; promotionIds: string[]; totalMinor: number; currency: string; days: number }>('/v1/promotions', input),
  list: (status?: string) => get<{ promotions: RoutePromotion[] }>(`/v1/promotions${status ? `?status=${status}` : ''}`),
  cancel: (id: string) => del<{ adjustedMinor: number }>(`/v1/promotions/${id}`),
  pause: (id: string) => post<{ status: 'paused' }>(`/v1/promotions/${id}/pause`, {}),
  resume: (id: string) => post<{ status: 'active'; endsAt: string }>(`/v1/promotions/${id}/resume`, {}),
};
