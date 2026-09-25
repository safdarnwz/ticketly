/**
 * OTA inventory release (#42, #170).
 *
 * The share of a trip's seats that OTAs / GDS partners may sell in total.
 * The platform sets the default; an operator can override it per service.
 * 100 = no limit (the historic behaviour).
 */
export interface OtaReleasePolicy {
  defaultReleasePct: number;
}

export const DEFAULT_OTA_RELEASE_POLICY: OtaReleasePolicy = { defaultReleasePct: 100 };

export function normaliseOtaReleasePolicy(
  stored: Partial<OtaReleasePolicy> | null | undefined,
): OtaReleasePolicy {
  return { ...DEFAULT_OTA_RELEASE_POLICY, ...(stored ?? {}) };
}

/** Seats OTAs may hold/sell on a trip of `capacity` seats at `releasePct` %. */
export function otaSeatAllowance(capacity: number, releasePct: number): number {
  return Math.floor((capacity * Math.min(100, Math.max(0, releasePct))) / 100);
}
