import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';

import type { RefundPolicy } from '../../domain/refund-policy';

/**
 * The operator settings booking needs, read from `tenants`. A read-only
 * window onto the tenancy module's table: TenancyModule imports BookingModule,
 * so booking cannot import tenancy's repository back without a module cycle.
 */
@Injectable()
export class OperatorPolicyRepository {
  constructor(private readonly db: DatabaseService) {}

  /** The operator's own cancellation tiers, or null to use the platform default. */
  async refundPolicy(tenantId: string): Promise<RefundPolicy | null> {
    const row = await this.db.queryOne<{ refund_policy: RefundPolicy | null }>(
      `SELECT refund_policy FROM tenants WHERE id = $1`,
      [tenantId],
      { name: 'booking.loadRefundPolicy', primary: true },
    );
    return row?.refund_policy ?? null;
  }
}
