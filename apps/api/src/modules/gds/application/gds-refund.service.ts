import { Injectable } from '@nestjs/common';

import { commissionClawbackMinor } from '../../agents/domain/agent-account';
import { GdsRepository } from '../infrastructure/gds.repository';

/**
 * A refund for a GDS-sold booking goes back to the PARTNER's account (the
 * partner refunds its own customer), minus the same share of the commission
 * it earned. Idempotent per refund id. Returns the commission clawed back so
 * RefundService can post the matching ledger reversal; null = not a GDS sale.
 */
@Injectable()
export class GdsRefundService {
  constructor(private readonly gds: GdsRepository) {}

  async creditRefund(input: {
    bookingId: string;
    refundId: string;
    refundMinor: number;
    tenantId: string;
  }): Promise<{ clawbackMinor: number } | null> {
    const owner = await this.gds.bookingOwner(input.bookingId);
    if (!owner?.partnerId) return null;
    const partnerId = owner.partnerId;
    await this.gds.getPartner(partnerId, true); // row lock (caller's transaction)
    const sale = await this.gds.saleFigures(partnerId, input.bookingId);
    const clawbackMinor = Math.min(
      sale.remainingCommissionMinor,
      commissionClawbackMinor({
        commissionCreditedMinor: sale.commissionMinor,
        refundMinor: input.refundMinor,
        paidMinor: sale.saleMinor,
      }),
    );
    await this.gds.post({
      partnerId,
      kind: 'refund_credit',
      magnitudeMinor: input.refundMinor,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      reference: `refund:${input.refundId}`,
    });
    if (clawbackMinor > 0) {
      await this.gds.post({
        partnerId,
        kind: 'commission_reversal',
        magnitudeMinor: clawbackMinor,
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        reference: `refund:${input.refundId}`,
      });
    }
    return { clawbackMinor };
  }
}
