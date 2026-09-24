import { Injectable } from '@nestjs/common';

import { PlatformChargeRepository } from '../infrastructure/platform-charge.repository';
import { PlatformSettingsRepository } from '../infrastructure/platform-settings.repository';

/** One-time and usage fees the platform charges an operator, at today's rates. */
@Injectable()
export class PlatformBillingService {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    private readonly charges: PlatformChargeRepository,
  ) {}

  /**
   * The one-time per-bus fee — the same amount for every operator. Runs inside
   * the vehicle registration's transaction, so it commits or rolls back with
   * it. The amount is snapshotted: a later rate change never rewrites what a
   * registered bus was charged. Once per vehicle (a retried registration
   * cannot double-charge). Not a taxable service line, so no GST.
   */
  async chargePerBusFee(tenantId: string, vehicleId: string): Promise<void> {
    await this.charges.add({
      tenantId,
      kind: 'per_bus_fee',
      amountMinor: await this.settings.perBusFeeMinor(),
      reference: { type: 'vehicle', id: vehicleId },
    });
  }

  /**
   * Per-message SMS / WhatsApp fee plus GST on it (the gateway is a platform
   * service). Email is free — callers never call this for email. Once per
   * notification, so an outbox retry cannot double-charge.
   */
  async chargeNotification(
    tenantId: string,
    channel: 'sms' | 'whatsapp',
    notificationId: string,
  ): Promise<void> {
    const [baseMinor, gstRatePct] = await Promise.all([
      channel === 'sms' ? this.settings.smsFeeMinor() : this.settings.whatsappFeeMinor(),
      this.settings.commissionGstRatePercent(),
    ]);
    if (baseMinor <= 0) return; // fee disabled
    const gstMinor = Math.round((baseMinor * gstRatePct) / 100);
    await this.charges.add({
      tenantId,
      kind: `notification_${channel}`,
      amountMinor: baseMinor + gstMinor,
      reference: { type: 'notification', id: notificationId },
      tax: { baseMinor, gstMinor },
    });
  }
}
