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

  /**
   * The one-time per-bus fee — the SAME ₹ amount for every operator (unlike
   * commission, never negotiated per-tenant). Called from inside
   * FleetController.createVehicle's existing transaction, so it commits or
   * rolls back atomically WITH the vehicle registration. The amount is
   * snapshotted at charge time: raising/lowering the global fee later never
   * rewrites what an already-registered bus was charged. Idempotent per
   * vehicle via the unique index on (kind, reference_type, reference_id) — a
   * retried "create vehicle" can never double-charge. A one-time registration
   * fee isn't itself a taxable service line the same way commission/notify
   * fees are, so gst_minor is 0 here (base_minor carries the full amount).
   */
  async chargePerBusFee(tenantId: string, vehicleId: string): Promise<void> {
    const amountMinor = await this.perBusFeeMinor();
    await this.db.execute_(
      `INSERT INTO platform_charges (id, tenant_id, kind, reference_type, reference_id, amount_minor, base_minor, gst_minor)
       VALUES (uuid_generate_v7(), $1, 'per_bus_fee', 'vehicle', $2, $3, $3, 0)
       ON CONFLICT (kind, reference_type, reference_id) DO NOTHING`,
      [tenantId, vehicleId, amountMinor],
      { name: 'platformSettings.chargePerBusFee', primary: true },
    );
  }

  /**
   * Per-message SMS/WhatsApp billing — ₹0.07 / ₹0.10 respectively, plus GST
   * on that fee (the SMS/WhatsApp gateway is a platform SERVICE, same
   * taxable-supply logic as commission — see migration 0024's comment).
   * Email is free: callers simply never call this for the 'email' channel.
   * Idempotent per notification via the unique index on
   * (kind, reference_type, reference_id) — a retried outbox delivery of the
   * same notification event can never double-charge.
   */
  async chargeNotification(tenantId: string, channel: 'sms' | 'whatsapp', notificationId: string): Promise<void> {
    const [baseMinor, gstRatePct] = await Promise.all([
      channel === 'sms' ? this.smsFeeMinor() : this.whatsappFeeMinor(),
      this.commissionGstRatePercent(),
    ]);
    if (baseMinor <= 0) return; // fee disabled — nothing to charge
    const gstMinor = Math.round((baseMinor * gstRatePct) / 100);
    const amountMinor = baseMinor + gstMinor;
    await this.db.execute_(
      `INSERT INTO platform_charges (id, tenant_id, kind, reference_type, reference_id, amount_minor, base_minor, gst_minor)
       VALUES (uuid_generate_v7(), $1, $2, 'notification', $3, $4, $5, $6)
       ON CONFLICT (kind, reference_type, reference_id) DO NOTHING`,
      [tenantId, `notification_${channel}`, notificationId, amountMinor, baseMinor, gstMinor],
      { name: 'platformSettings.chargeNotification', primary: true },
    );
  }
}
