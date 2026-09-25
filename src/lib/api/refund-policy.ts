import { get, patch, post } from './client';

export interface RefundTier {
  minHoursBeforeDeparture: number;
  refundPct: number;
}

export interface RefundPolicy {
  tiers: RefundTier[];
  flatFeeMinor?: number;
  cutoffHours?: number;
}

export const refundPolicyApi = {
  get: () => get<{ policy: RefundPolicy; isCustom: boolean }>('/v1/operator/refund-policy'),
  set: (policy: RefundPolicy) => patch<{ ok: boolean; policy: RefundPolicy }>('/v1/operator/refund-policy', policy),
  reset: () => post<{ ok: boolean; policy: RefundPolicy }>('/v1/operator/refund-policy/reset', {}),
};
