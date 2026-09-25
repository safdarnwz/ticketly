import { describe, expect, it } from 'vitest';

import { AppError, InternalError } from '../errors';
import type { TenantId, UserId } from '../ids';
import {
  contextLogFields,
  createContext,
  elapsedMs,
  getContext,
  getRequestId,
  getTenantId,
  getUserId,
  hasFeature,
  hasPermission,
  requireContext,
  requireTenantId,
  runAsTenant,
  runInNewContext,
  runWithContext,
} from '../request-context';

const T = '01a0d3e5-6408-7523-9b95-937896932868' as TenantId;
const U = '01a0d3e5-66e8-7ebd-8e54-a19f3acd5af3' as UserId;

describe('request context', () => {
  it('is empty outside a request', () => {
    expect(getContext()).toBeUndefined();
    expect(() => requireContext()).toThrow(InternalError);
    expect(hasPermission('x')).toBe(false);
    expect(hasFeature('x')).toBe(false);
    expect(elapsedMs()).toBe(0);
    expect(contextLogFields()).toEqual({});
    expect(getTenantId()).toBeUndefined();
  });

  it('binds the context to the async path', async () => {
    const ctx = createContext({
      tenantId: T,
      userId: U,
      actorType: 'user',
      permissions: ['booking:read'],
      features: ['gds'],
      traceId: 'trace-1',
    });
    await runWithContext(ctx, async () => {
      await Promise.resolve();
      expect(requireTenantId()).toBe(T);
      expect(getUserId()).toBe(U);
      expect(getRequestId()).toBe(ctx.requestId);
      expect(hasPermission('booking:read')).toBe(true);
      expect(hasPermission('payment:refund')).toBe(false);
      expect(hasFeature('gds')).toBe(true);
      expect(elapsedMs()).toBeGreaterThanOrEqual(0);
      expect(contextLogFields()).toMatchObject({
        tenantId: T,
        userId: U,
        traceId: 'trace-1',
        actorType: 'user',
      });
    });
  });

  it('wildcard permission satisfies any check', () => {
    runInNewContext({ permissions: ['*'] }, () => expect(hasPermission('anything')).toBe(true));
  });

  it('refuses tenant-scoped work without a tenant, and can act as one', () => {
    runInNewContext({ actorType: 'system' }, () => {
      expect(() => requireTenantId()).toThrow(AppError);
      expect(runAsTenant(T, () => requireTenantId())).toBe(T);
      expect(getTenantId()).toBeUndefined();
    });
  });

  it('defaults: anonymous actor, correlation id = request id', () => {
    const ctx = createContext();
    expect(ctx.actorType).toBe('anonymous');
    expect(ctx.correlationId).toBe(ctx.requestId);
  });
});
