import { describe, expect, it } from 'vitest';

import { isFeatureAllowed, quotaExceeded, resolveEntitlements } from '../domain/entitlements';

const viaRedis = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('entitlements', () => {
  it('B44: the cached form survives a JSON (Redis) round-trip intact', () => {
    const e = viaRedis(
      resolveEntitlements({ distribution: true, sso: false }, {}, { maxVehicles: 25 }),
    );
    expect(e.features).toEqual(['distribution']);
    expect(isFeatureAllowed({ disabled: new Set(e.disabled) }, 'sso')).toBe(false);
  });
  it('only an explicit false blocks; no plan / unmentioned = allowed', () => {
    const starter = resolveEntitlements({ distribution: false }, {}, {});
    expect(isFeatureAllowed(starter, 'distribution')).toBe(false);
    expect(isFeatureAllowed(starter, 'somethingNew')).toBe(true);
    expect(isFeatureAllowed(resolveEntitlements(null, null, null), 'distribution')).toBe(true);
  });
  it('58/59: an operator override beats the plan, both ways', () => {
    expect(
      isFeatureAllowed(
        resolveEntitlements({ distribution: false }, { distribution: true }, {}),
        'distribution',
      ),
    ).toBe(true);
    expect(
      isFeatureAllowed(
        resolveEntitlements({ distribution: true }, { distribution: false }, {}),
        'distribution',
      ),
    ).toBe(false);
  });
  it('102–104: quota at the limit is exceeded; null / missing = unlimited', () => {
    const q = resolveEntitlements({}, {}, { maxVehicles: 25, maxUsers: null }).quotas;
    expect(quotaExceeded(q, 'maxVehicles', 25)).toBe(25);
    expect(quotaExceeded(q, 'maxVehicles', 24)).toBeNull();
    expect(quotaExceeded(q, 'maxUsers', 99999)).toBeNull();
    expect(quotaExceeded(q, 'maxBranches', 99999)).toBeNull();
  });
});
