import { get, patch, post } from './client';

export interface RefundTier {
  minHoursBeforeDeparture: number;
  refundPct: number;
}

export interface RefundPolicy {
  tiers: RefundTier[];
  flatFeeMinor?: number;
  cutoffHours?: number;
  /** Off = customers, agents and partners cancel whole bookings only (staff still can split). */
  partialCancellation?: boolean;
  /** Minutes after departure before a passenger can be marked a no-show (0–240). */
  noShowGraceMinutes?: number;
  /** Full refund when cancelled within this many hours of paying (0 = no free window, max 72). */
  freeCancellationHours?: number;
}

export const refundPolicyApi = {
  get: () => get<{ policy: RefundPolicy; isCustom: boolean }>('/v1/operator/refund-policy'),
  set: (policy: RefundPolicy) => patch<{ ok: boolean; policy: RefundPolicy }>('/v1/operator/refund-policy', policy),
  reset: () => post<{ ok: boolean; policy: RefundPolicy }>('/v1/operator/refund-policy/reset', {}),
};
