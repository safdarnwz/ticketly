import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { AppConfig } from '@config';
import { getContext, parseUuid, type TenantId } from '@kernel';

import { TenantRepository } from '../../tenancy';

/**
 * ============================================================================
 *  Tenant resolution
 * ============================================================================
 *
 * Runs after the request-context middleware and BEFORE the auth guard, so the
 * tenant is bound as early as possible — the RLS GUC, the logger and every
 * repository then scope to it automatically.
 *
 * Resolution order (first hit wins), covering every way a request identifies
 * its operator on a multi-operator platform:
 *   1. `X-Tenant-Id` header — internal / console calls that already know the id.
 *   2. Host — Ticketly's three-domain scheme, or a verified custom domain:
 *        - `www.ticketly.com` (+ apex)  → customer storefront, NO tenant
 *          (customer accounts are central/tenant-less; see docs/ACCOUNTS_ONBOARDING.md).
 *        - `app.ticketly.com`           → platform/super-admin console, NO tenant
 *          (this host must NEVER resolve to a tenant — see the null-check below).
 *        - `app.<slug>.ticketly.com`    → tenant admin console for `<slug>`; the
 *          tenant slug is the SECOND label, because `app` is fixed.
 *        - anything else (a verified custom domain like `www.orangetravels.com`)
 *          → resolved by the full host, falling back to its left-most label.
 *   3. Left to the auth layer — a JWT or API key carries its own tenant, bound
 *      by the auth guard.
 *
 * The slug→id lookup is cached (short TTL) because it happens on every
 * storefront/console request and the mapping changes almost never.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  private readonly baseDomain: string;
  /** Hosts that are the platform itself and must NEVER resolve to a tenant. */
  private readonly platformHosts: Set<string>;
  private readonly isProduction: boolean;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly cache: CacheService,
    config: AppConfig,
  ) {
    const base = new URL(config.app.publicBaseUrl).hostname; // e.g. "ticketly.com"
    this.baseDomain = base;
    this.isProduction = config.isProduction;
    this.platformHosts = new Set([
      base, // ticketly.com (apex)
      `www.${base}`, // www.ticketly.com — customer storefront
      `app.${base}`, // app.ticketly.com — super-admin console
      'localhost',
      '127.0.0.1',
      'www.localhost',
      'app.localhost', // local-dev alias — matches vite.config.ts's dev server host
    ]);
  }

  async use(request: FastifyRequest['raw'], _res: unknown, next: () => void): Promise<void> {
    const ctx = getContext();
    if (!ctx) return next();

    const host = single(request.headers['host'])?.split(':')[0]?.toLowerCase();
    // Ground truth for "which of the three domains is this?" — used later by
    // AuthService to enforce that a login only succeeds on ITS OWN host.
    // Computed from the real Host header regardless of the override paths
    // below, so an internal `X-Tenant-Id` call can't be used to bypass it.
    ctx.extra.authSurface = this.surfaceForHost(host);

    // Dev/local-tooling convenience ONLY (ignored in production): lets Postman,
    // curl, or the web app hit plain `localhost` and still declare which
    // surface they're simulating, since `localhost` obviously can't BE
    // `app.ticketly.com`. Real deployments never need this — the Host header
    // already says which domain it is.
    if (!this.isProduction) {
      const debugSurface = single(request.headers['x-debug-surface']);
      if (
        debugSurface === 'customer' ||
        debugSurface === 'superAdmin' ||
        debugSurface === 'tenantAdmin'
      ) {
        ctx.extra.authSurface = debugSurface;
      }
    }

    const headerTenant = single(request.headers['x-tenant-id']);
    if (headerTenant) {
      const id = parseUuid(headerTenant);
      if (id) {
        ctx.tenantId = id as unknown as TenantId;
        return next();
      }
    }

    // Dev/local-tooling convenience only: lets the web app simulate
    // `app.<slug>.ticketly.com` while running on a plain `localhost` origin
    // that has no real subdomain to resolve against. Production traffic
    // always has the real Host header, so this is never the primary path.
    const headerSlug = single(request.headers['x-tenant-slug']);
    if (headerSlug) {
      const resolved = await this.resolveByHost(headerSlug);
      if (resolved) {
        ctx.tenantId = resolved;
        ctx.extra.authSurface = 'tenantAdmin'; // the header IS simulating that console
        return next();
      }
    }

    if (host && !this.platformHosts.has(host)) {
      const resolved = await this.resolveByHost(host);
      if (resolved) ctx.tenantId = resolved;
    }

    next();
  }

  /**
   * Which of Ticketly's three canonical hosts (if any) this request came in on.
   * Recognises the real domain (`this.baseDomain`, e.g. `ticketly.com`) AND
   * `localhost` as an equivalent base — `vite.config.ts` runs the console dev
   * server on `app.localhost` precisely so this matches without any Host
   * spoofing or the `X-Debug-Surface` dev header. A Host of literally
   * `app.localhost` reaching a real deployment can't do anything a valid
   * super-admin login wouldn't already allow, so treating it as an alias
   * everywhere (not just non-production) is safe.
   */
  private surfaceForHost(
    host: string | undefined,
  ): 'customer' | 'superAdmin' | 'tenantAdmin' | 'unresolved' {
    if (!host) return 'unresolved';
    for (const base of [this.baseDomain, 'localhost']) {
      if (host === base || host === `www.${base}`) return 'customer';
      if (host === `app.${base}`) return 'superAdmin';
      const tenantConsoleSuffix = `.${base}`;
      if (host.startsWith('app.') && host.endsWith(tenantConsoleSuffix)) {
        const slug = host.slice('app.'.length, host.length - tenantConsoleSuffix.length);
        if (slug && !slug.includes('.')) return 'tenantAdmin';
      }
    }
    if (host === '127.0.0.1') return 'customer';
    return 'unresolved'; // a not-yet-verified / legacy custom domain
  }

  private async resolveByHost(host: string): Promise<TenantId | null> {
    // `app.<slug>.ticketly.com` (or the `app.<slug>.localhost` dev alias) →
    // the slug is the label right after "app.".
    const tenantConsolePrefix = `app.`;
    let candidateKey = host;
    for (const base of [this.baseDomain, 'localhost']) {
      const tenantConsoleSuffix = `.${base}`;
      if (host.startsWith(tenantConsolePrefix) && host.endsWith(tenantConsoleSuffix)) {
        const slug = host.slice(
          tenantConsolePrefix.length,
          host.length - tenantConsoleSuffix.length,
        );
        // Guard against "app..ticketly.com" or a slug that itself contains a
        // dot reaching back into "app" / the base domain — treat as unresolved.
        if (!slug || slug.includes('.')) return null;
        candidateKey = slug;
        break;
      }
    }

    // Fallback candidate for custom domains: the left-most label (legacy
    // `orange-travels.book.example.com`-style subdomains, if still in use).
    const fallbackSlug = host.split('.')[0];

    const cacheKey = `host:${host}`;
    const candidate = await this.cache.getOrLoad<string | null>(
      cacheKey,
      { namespace: CacheNamespace.TENANT, ttlSeconds: CacheTtl.TENANT_CONFIG },
      async () => {
        const bySlugOrExactHost = await this.tenants.findBySlugOrDomain(candidateKey);
        if (bySlugOrExactHost) return bySlugOrExactHost.id;
        if (candidateKey !== fallbackSlug) {
          const byFallback = await this.tenants.findBySlugOrDomain(fallbackSlug);
          if (byFallback) return byFallback.id;
        }
        return null;
      },
    );
    return (candidate ?? null) as TenantId | null;
  }
}

function single(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
