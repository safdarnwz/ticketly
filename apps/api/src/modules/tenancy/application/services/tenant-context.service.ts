import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { AppError, ErrorCode, NotFoundError, type TenantId } from '@kernel';

import { PlanRepository } from '../../infrastructure/persistence/plan.repository';
import { isFeatureAllowed, quotaExceeded, resolveEntitlements } from '../../domain/entitlements';
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository';

/**
 * Resolves the effective runtime profile of a tenant: its status, its enabled
 * features and its quotas — with the plan and per-tenant overrides merged.
 *
 * This is on the hot path (consulted on virtually every authenticated request
 * to decide feature access), so the whole resolved profile is cached with a
 * short TTL. A plan or override change therefore takes effect within seconds
 * without a deploy, and a suspended operator stops being served within the same
 * window.
 */
export interface TenantProfile {
  tenantId: TenantId;
  slug: string;
  status: string;
  displayName: string;
  timezone: string;
  currency: string;
  locale: string;
  features: Set<string>;
  /** Features EXPLICITLY switched off by the plan or an operator override. Anything not listed is allowed. */
  disabled: Set<string>;
  quotas: Record<string, number>;
}

/** JSON-safe form of TenantProfile, as stored in the L1/L2 cache. */
type CachedProfile = Omit<TenantProfile, 'features' | 'disabled'> & {
  features: string[];
  disabled: string[];
};

/** Tolerates entries cached by an older build (a Set that became {}). */
function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

@Injectable()
export class TenantContextService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly plans: PlanRepository,
    private readonly cache: CacheService,
  ) {}

  async getProfile(tenantId: TenantId): Promise<TenantProfile> {
    // The cached value is PLAIN JSON (arrays, not Sets): it round-trips through
    // Redis, where a Set would serialise to {} and `new Set({})` throws —
    // which failed every request of that operator on any instance that got the
    // profile from L2 (multi-instance production) instead of its own memory.
    const cached = await this.cache.getOrLoad<CachedProfile | null>(
      tenantId,
      { namespace: CacheNamespace.TENANT_FEATURES, ttlSeconds: CacheTtl.TENANT_CONFIG },
      async () => this.buildProfile(tenantId),
    );
    if (!cached) throw new NotFoundError('Operator', tenantId);
    return {
      ...cached,
      features: new Set(asList(cached.features)),
      disabled: new Set(asList(cached.disabled)),
      quotas: cached.quotas ?? {},
    };
  }

  /** Assert the tenant can be served right now; throws for suspended/closed. */
  async assertServable(tenantId: TenantId): Promise<TenantProfile> {
    const profile = await this.getProfile(tenantId);
    if (profile.status === 'suspended') {
      throw new AppError(ErrorCode.TENANT_SUSPENDED, 403, {
        message: 'This operator account is suspended',
      });
    }
    if (profile.status === 'closed' || profile.status === 'provisioning') {
      throw new AppError(ErrorCode.TENANT_NOT_RESOLVED, 403, {
        message: 'This operator account is not active',
      });
    }
    return profile;
  }

  /**
   * Only an EXPLICIT `false` (plan or per-operator override) blocks a feature.
   * Operators without a plan, and features a plan never mentions, stay
   * enabled — so turning enforcement on can never lock existing operators
   * out of features they already use.
   */
  requireFeature(profile: TenantProfile, feature: string): void {
    if (!isFeatureAllowed(profile, feature)) {
      throw new AppError(ErrorCode.TENANT_FEATURE_DISABLED, 403, {
        message: `Feature '${feature}' is not enabled on your plan`,
        details: { feature },
      });
    }
  }

  /** Plan quota check before creating one more of something. No plan or a null quota = unlimited. */
  async assertQuota(
    tenantId: TenantId,
    key: string,
    currentCount: number,
    label: string,
  ): Promise<void> {
    const profile = await this.getProfile(tenantId);
    const limit = quotaExceeded(profile.quotas, key, currentCount);
    if (limit !== null) {
      throw new AppError(ErrorCode.TENANT_QUOTA_EXCEEDED, 403, {
        message: `Your plan allows ${limit} ${label} — upgrade your plan to add more`,
        details: { quota: key, limit, current: currentCount },
      });
    }
  }

  /** Invalidate the cached profile after any tenant/plan mutation. */
  async invalidate(tenantId: TenantId): Promise<void> {
    await Promise.all([
      this.cache.invalidate(tenantId, CacheNamespace.TENANT_FEATURES),
      this.cache.invalidate(tenantId, CacheNamespace.TENANT),
    ]);
  }

  private async buildProfile(tenantId: TenantId): Promise<CachedProfile | null> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) return null;
    const snap = tenant.snapshot();

    const plan = snap.planId ? await this.plans.findById(snap.planId) : null;

    // Effective features = plan features ∪ per-tenant overrides.
    // An override of `false` explicitly disables a plan feature.
    const { features, disabled, quotas } = resolveEntitlements(
      plan?.features,
      snap.featureOverrides,
      plan?.quotas,
    );

    return {
      tenantId,
      slug: snap.slug,
      status: snap.status,
      displayName: snap.displayName,
      timezone: snap.timezone,
      currency: snap.currency,
      locale: snap.locale,
      features,
      disabled,
      quotas,
    };
  }
}
