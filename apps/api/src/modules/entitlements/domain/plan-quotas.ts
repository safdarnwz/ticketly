/**
 * Plan quotas — how many of a thing an operator's plan allows (#102–#104).
 * Keys match the `plans.quotas` JSON. A missing, null or negative value
 * means unlimited (the seed uses -1 for the enterprise plan).
 */
export const QUOTA_KEYS = {
  users: 'max_users',
  routes: 'max_routes',
  vehicles: 'max_vehicles',
  branches: 'max_branches',
  agents: 'max_agents',
} as const;

export type QuotaKey = (typeof QUOTA_KEYS)[keyof typeof QUOTA_KEYS];

/** null = one more is allowed; otherwise the limit that adding one more would exceed. */
export function quotaExceeded(
  quotas: Record<string, unknown>,
  key: string,
  currentCount: number,
): number | null {
  const limit = quotas[key];
  return typeof limit === 'number' && limit >= 0 && currentCount >= limit ? limit : null;
}
