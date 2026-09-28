import { get, post, put } from './client';

/** An operator's waitlist rules (the platform default until it sets its own). */
export interface WaitlistRules { maxPerTrip: number; maxSeatsPerEntry: number; closeMinutesBefore: number; entryExpiryHours: number | null }

export const waitlistRulesApi = {
  get: () => get<{ rules: WaitlistRules; isCustom: boolean }>('/v1/operator/waitlist-rules'),
  set: (rules: WaitlistRules) => put<{ ok: boolean; rules: WaitlistRules }>('/v1/operator/waitlist-rules', rules),
  reset: () => post<{ ok: boolean; rules: WaitlistRules }>('/v1/operator/waitlist-rules/reset', {}),
};

/** What a passenger may carry free and what more costs (null until published). */
export interface OperatorLuggagePolicy { freeKg: number; freePieces: number; extraPerKgMinor: number | null; note: string }

export const luggagePolicyApi = {
  get: () => get<{ policy: OperatorLuggagePolicy | null }>('/v1/operator/luggage-policy'),
  set: (policy: OperatorLuggagePolicy) => put<{ ok: boolean; policy: OperatorLuggagePolicy }>('/v1/operator/luggage-policy', policy),
  reset: () => post<{ ok: boolean; policy: null }>('/v1/operator/luggage-policy/reset', {}),
};

/** Pets, liquor, smoking, how long the bus waits, own notes — "Other policies" under every trip. */
export interface TravelPolicies {
  pets: 'not_allowed' | 'small_in_carrier' | 'allowed';
  liquor: 'prohibited' | 'sealed_in_luggage';
  smoking: 'prohibited' | 'at_stops_only';
  pickupWaitMinutes: number;
  notes: string[];
}
export const travelPoliciesApi = {
  get: () => get<{ policies: TravelPolicies | null }>('/v1/operator/travel-policies'),
  set: (p: TravelPolicies) => put<{ ok: boolean; policies: TravelPolicies }>('/v1/operator/travel-policies', p),
  reset: () => post<{ ok: boolean; policies: null }>('/v1/operator/travel-policies/reset', {}),
};

/** One add-on the operator sells at checkout (insurance, meal, extra bag…). */
export interface AddOn { id: string; code: string; name: string; kind: 'insurance' | 'meal' | 'luggage' | 'priority' | 'other'; priceMinor: number; perPassenger: boolean; active: boolean }

export const addOnsApi = {
  list: () => get<{ items: AddOn[] }>('/v1/me/ancillaries/catalogue'),
  /** Create, or update by code; `active: false` stops offering it. */
  save: (a: Omit<AddOn, 'id'>) => post<{ id: string }>('/v1/me/ancillaries/catalogue', a),
};
