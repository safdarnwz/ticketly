import { get, post, put } from './client';

/** An operator's waitlist rules (the platform default until it sets its own). */
export interface WaitlistRules { maxPerTrip: number; maxSeatsPerEntry: number; closeMinutesBefore: number; entryExpiryHours: number | null }

export const waitlistRulesApi = {
  get: () => get<{ rules: WaitlistRules; isCustom: boolean }>('/v1/operator/waitlist-rules'),
  set: (rules: WaitlistRules) => put<{ ok: boolean; rules: WaitlistRules }>('/v1/operator/waitlist-rules', rules),
  reset: () => post<{ ok: boolean; rules: WaitlistRules }>('/v1/operator/waitlist-rules/reset', {}),
};
