import { describe, expect, it } from 'vitest';

import { QUOTA_KEYS, quotaExceeded } from '../domain/plan-quotas';

describe('quotaExceeded', () => {
  const starter = { max_vehicles: 25, max_users: 5, max_routes: -1, max_agents: null };

  it('blocks the one past the limit', () => {
    expect(quotaExceeded(starter, QUOTA_KEYS.vehicles, 25)).toBe(25);
    expect(quotaExceeded(starter, QUOTA_KEYS.vehicles, 24)).toBeNull();
  });

  it('treats negative, null and missing limits as unlimited', () => {
    expect(quotaExceeded(starter, QUOTA_KEYS.routes, 10_000)).toBeNull();
    expect(quotaExceeded(starter, QUOTA_KEYS.agents, 10_000)).toBeNull();
    expect(quotaExceeded(starter, QUOTA_KEYS.branches, 10_000)).toBeNull();
  });
});
