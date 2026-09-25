import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService } from '@cache';
import { AppConfig } from '@config';
import { AppError, ErrorCode, NotFoundError, type TenantId } from '@kernel';

import { TenantRepository } from '../../infrastructure/persistence/tenant.repository';
import { TenantContextService } from './tenant-context.service';

/**
 * White-label identity of an operator: its own domain (#4) and favicon (#67),
 * plus the public branding a customer site renders.
 */
@Injectable()
export class TenantBrandingService {
  private readonly baseDomain: string;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly cache: CacheService,
    private readonly tenantContext: TenantContextService,
    config: AppConfig,
  ) {
    this.baseDomain = new URL(config.app.publicBaseUrl).hostname.toLowerCase();
  }

  /**
   * Point a custom domain at an operator. Ticketly's own domain (and its
   * subdomains) can never be claimed; a domain another operator already has
   * is a 409 (unique index). The host → tenant lookup cache is dropped for
   * both the old and the new domain so the change applies at once.
   */
  async setDomain(tenantId: string, domain: string | null): Promise<{ domain: string | null }> {
    if (domain && (domain === this.baseDomain || domain.endsWith(`.${this.baseDomain}`)))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `${this.baseDomain} and its subdomains belong to Ticketly`,
      });
    const result = await this.tenants.setPrimaryDomain(tenantId, domain);
    if (!result) throw new NotFoundError('Operator', tenantId);
    for (const host of [result.previous, domain])
      if (host) await this.cache.invalidate(`host:${host.toLowerCase()}`, CacheNamespace.TENANT);
    await this.tenantContext.invalidate(tenantId as TenantId);
    return { domain };
  }

  async setFavicon(tenantId: string, dataUri: string | null): Promise<void> {
    if (!(await this.tenants.setFavicon(tenantId, dataUri)))
      throw new NotFoundError('Operator', tenantId);
  }

  async branding(tenantId: string) {
    const b = await this.tenants.branding(tenantId);
    if (!b) throw new NotFoundError('Operator', tenantId);
    return b;
  }
}
