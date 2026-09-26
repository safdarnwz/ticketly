import { del, download, get, post, put } from './client';

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

export interface PeakWindow { startMinute: number; endMinute: number; pct: number; label?: string }
export interface RouteRules { floorMinor: number | null; ceilingMinor: number | null; peakWindows: PeakWindow[] }

/** Route-level fare guard rails and time-of-day changes, one-trip changes, and whole-sheet edits. */
export const fareRulesApi = {
  routeRules: (routeId: string) => get<RouteRules>(`/v1/pricing/routes/${routeId}/rules`),
  saveRouteRules: (routeId: string, rules: RouteRules) => put<{ ok: boolean }>(`/v1/pricing/routes/${routeId}/rules`, rules),
  tripAdjustment: (tripId: string) => get<{ pct: number | null; reason: string | null; updatedAt: string | null }>(`/v1/pricing/trips/${tripId}/adjustment`),
  setTripAdjustment: (tripId: string, pct: number | null, reason?: string) => put<{ ok: boolean }>(`/v1/pricing/trips/${tripId}/adjustment`, { pct, reason }),
  exportCsv: (planId: string) => download(`/v1/pricing/fare-plans/${planId}/rules.csv`, 'fare-rules.csv'),
  importRows: (planId: string, rows: { fromStopId?: string; toStopId?: string; seatType: string; baseFareMinor: number; perKmMinor?: number }[]) =>
    post<{ saved: number }>(`/v1/pricing/fare-plans/${planId}/rules/import`, { rows }),
  adjustAll: (planId: string, percent: number, seatType?: string) =>
    post<{ updated: number }>(`/v1/pricing/fare-plans/${planId}/rules/adjust`, { percent, seatType, roundToMinor: 100 }),
};
