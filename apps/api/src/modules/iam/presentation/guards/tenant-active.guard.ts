import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { getContext } from '@kernel';

import { TenantContextService } from '../../../tenancy/application/services/tenant-context.service';

/**
 * Ensures the resolved tenant is actually servable (active, not suspended).
 *
 * Split from the auth guard on purpose: authentication ("who are you") and
 * tenant-serviceability ("is this operator allowed to trade right now") are
 * different questions with different failure codes. A suspended operator's
 * staff can still authenticate — they just can't transact — which is exactly
 * what a billing-suspension flow needs.
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const ctx = getContext();
    if (!ctx?.tenantId) return true; // platform-admin / public routes carry no tenant
    const profile = await this.tenantContext.assertServable(ctx.tenantId);
    // Cache the resolved features on the context so feature guards avoid a
    // second lookup within the same request.
    (ctx.features as Set<string>) = profile.features;
    return true;
  }
}
