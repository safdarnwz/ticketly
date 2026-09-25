import { get, post, del } from './client';

export interface FarePlan { id: string; routeId: string; name: string; currency: string; status: string }
export interface FareRule { id: string; fromStopId: string | null; toStopId: string | null; seatType: string; baseFareMinor: number; perKmMinor: number | null }
export interface YieldLadder {
  occupancy: { atPct: number; mult: number }[];
  advancePurchase: { withinDays: number; mult: number }[];
  maxMultiplier: number;
  minMultiplier: number;
}
export interface PricingPolicy { id: string; routeId: string | null; name: string; ladder: YieldLadder; isActive: boolean; createdAt: string }
export interface Coupon { id: string; code: string; kind: string; value: number; usageCount: number; maxRedemptions: number | null; validFrom: string | null; validTo: string | null; isActive?: boolean; firstBookingOnly?: boolean; description?: string | null; minFareMinor?: number | null; maxDiscountMinor?: number | null; perUserLimit?: number | null }
export interface SeatFareOverride { id: string; seatNumber: string; fareMinor: number }

export const pricingAdminApi = {
  listPlans: () => get<{ plans: FarePlan[] }>('/v1/pricing/fare-plans'),
  createPlan: (input: { routeId: string; name: string; currency?: string; effectiveFrom?: string; effectiveTo?: string }) =>
    post<{ id: string }>('/v1/pricing/fare-plans', input),
  activatePlan: (id: string) => post<{ ok: boolean }>(`/v1/pricing/fare-plans/${id}/activate`, {}),
  listRules: (farePlanId: string) => get<{ rules: FareRule[] }>(`/v1/pricing/fare-plans/${farePlanId}/rules`),
  addRule: (input: { farePlanId: string; fromStopId?: string; toStopId?: string; seatType: string; baseFareMinor: number; perKmMinor?: number }) =>
    post<{ ok: boolean }>('/v1/pricing/fare-plans/rules', input),

  listSeatOverrides: (farePlanId: string) => get<{ items: SeatFareOverride[] }>(`/v1/pricing/fare-plans/${farePlanId}/seat-overrides`),
  setSeatOverride: (farePlanId: string, seatNumber: string, fareMinor: number) =>
    post<{ ok: boolean }>(`/v1/pricing/fare-plans/${farePlanId}/seat-overrides`, { seatNumber, fareMinor }),
  deleteSeatOverride: (overrideId: string) => del<{ ok: boolean }>(`/v1/pricing/fare-plans/seat-overrides/${overrideId}`),

  listPolicies: () => get<{ policies: PricingPolicy[] }>('/v1/pricing/policies'),
  createPolicy: (input: { routeId?: string; name: string; ladder: YieldLadder }) =>
    post<{ id: string }>('/v1/pricing/policies', input),
  deactivatePolicy: (id: string) => post<{ ok: boolean }>(`/v1/pricing/policies/${id}/deactivate`, {}),

  listCoupons: () => get<{ coupons: Coupon[] }>('/v1/pricing/coupons'),
  createCoupon: (input: {
    code: string; kind: 'percent' | 'flat'; value: number; maxDiscountMinor?: number; minFareMinor?: number;
    validFrom?: string; validTo?: string; maxRedemptions?: number; perUserLimit?: number;
    firstBookingOnly?: boolean; description?: string;
  }) => post<{ id: string }>('/v1/pricing/coupons', input),
  disableCoupon: (id: string) => post<{ ok: boolean }>(`/v1/pricing/coupons/${id}/disable`, {}),
  enableCoupon: (id: string) => post<{ ok: boolean }>(`/v1/pricing/coupons/${id}/enable`, {}),
  couponStats: (id: string) => get<{ usageCount: number; maxRedemptions: number | null; estimatedDiscountGivenMinor: number }>(`/v1/pricing/coupons/${id}/stats`),
};
