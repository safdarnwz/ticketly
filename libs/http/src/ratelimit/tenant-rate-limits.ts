import { Injectable } from '@nestjs/common';

/** Per-operator request limit override (#62), or null for the platform default. */
export type TenantRateLimitResolver = (tenantId: string) => Promise<number | null>;

/**
 * Where the rate-limit guard asks for an operator's own limit. The tenancy
 * module (which owns the setting) registers the resolver; with none
 * registered every operator gets the platform default.
 */
@Injectable()
export class TenantRateLimits {
  private resolver: TenantRateLimitResolver | null = null;

  register(resolver: TenantRateLimitResolver): void {
    this.resolver = resolver;
  }

  async limitFor(tenantId: string): Promise<number | null> {
    return this.resolver ? this.resolver(tenantId) : null;
  }
}
