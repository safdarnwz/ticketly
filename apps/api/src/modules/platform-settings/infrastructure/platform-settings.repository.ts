import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService } from '@database';

/**
 * Platform-wide settings — a small key-value store for the handful of global
 * numbers the super admin tunes (default commission %, the per-bus one-time
 * fee). Cache-backed with a long TTL since these change maybe monthly, and
 * every booking's commission calculation reads the default.
 */
@Injectable()
export class PlatformSettingsRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    return this.cache.getOrLoad(
      `platform-setting:${key}`,
      { namespace: CacheNamespace.TENANT, ttlSeconds: CacheTtl.MASTER_DATA },
      async () => {
        const row = await this.db.queryOne<{ value: T }>(
          `SELECT value FROM platform_settings WHERE key = $1`,
          [key],
          { name: 'platformSettings.get', primary: true },
        );
        return row ? row.value : fallback;
      },
    );
  }

  async set(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    await this.db.execute_(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), updatedBy],
      { name: 'platformSettings.set', primary: true },
    );
    await this.cache.invalidatePrefix(CacheNamespace.TENANT);
  }

  async defaultCommissionPercent(): Promise<number> {
    return this.get<number>('default_commission_percent', 1);
  }

  async perBusFeeMinor(): Promise<number> {
    return this.get<number>('per_bus_fee_minor', 499900);
  }

  /**
   * GST rate — GOVERNMENT-mandated, so this is a PLATFORM setting, never an
   * operator input. An operator choosing their own tax rate is exactly the
   * kind of thing that makes a GST filing wrong (over- or under-charging
   * the government) — this used to be settable per-tenant via
   * `pricing_policies.gst_rate_pct` (PricingController.createPolicy), which
   * has been changed to ignore that field entirely and read this instead.
   */
  async gstRatePercent(): Promise<number> {
    return this.get<number>('gst_rate_pct', 5);
  }

  /**
   * GST on the PLATFORM'S OWN commission (a facilitation/agent service) —
   * NOT the ticket's transport GST above. India taxes agent/commission
   * services at the standard services rate (18%), distinct from the reduced
   * rate on passenger transport itself. See migration 0023.
   */
  async commissionGstRatePercent(): Promise<number> {
    return this.get<number>('commission_gst_rate_pct', 18);
  }

  /** Per-message SMS fee charged to the operator (before GST). See migration 0024. */
  async smsFeeMinor(): Promise<number> {
    return this.get<number>('sms_fee_minor', 7);
  }

  /** Per-message WhatsApp fee charged to the operator (before GST). Email is free — no equivalent setting. */
  async whatsappFeeMinor(): Promise<number> {
    return this.get<number>('whatsapp_fee_minor', 10);
  }
}
