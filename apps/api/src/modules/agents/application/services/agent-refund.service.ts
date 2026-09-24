import { Injectable } from '@nestjs/common';

import type { BookingId } from '@kernel';

import { commissionClawbackMinor } from '../../domain/agent-account';
import { AgentRepository } from '../../infrastructure/persistence/agent.repository';

/**
 * Credits a refund for an AGENT-sold booking back to that agent's account
 * (the operator holds the cash, so a gateway refund would be impossible and
 * the wrong actor) and claws back the same share of the agent's commission.
 *
 * Deliberately tiny — depends only on AgentRepository — so the refunds module
 * can use it without pulling in booking/payment/IAM (no circular imports).
 * Must run inside the caller's unit of work.
 */
@Injectable()
export class AgentRefundService {
  constructor(private readonly agents: AgentRepository) {}

  /** @returns false if the booking was not sold by an agent. Idempotent per refund id. */
  async creditRefund(input: {
    bookingId: BookingId;
    refundId: string;
    refundMinor: number;
  }): Promise<boolean> {
    const agentId = await this.agents.agentForBooking(input.bookingId);
    if (!agentId) return false;
    await this.agents.lockForUpdate(agentId);
    const sale = await this.agents.saleFigures(agentId, input.bookingId);
    // Proportion of the ORIGINAL sale (not the booking's reduced totals), capped
    // at what is still un-reversed — so every partial refund claws back its
    // exact share and the agent never keeps commission on a refunded seat.
    const clawback = Math.min(
      sale.remainingCommissionMinor,
      commissionClawbackMinor({
        commissionCreditedMinor: sale.commissionMinor,
        refundMinor: input.refundMinor,
        paidMinor: sale.saleMinor,
      }),
    );
    await this.agents.post({
      agentId,
      kind: 'refund_credit',
      magnitudeMinor: input.refundMinor,
      bookingId: input.bookingId,
      reference: `refund:${input.refundId}`,
    });
    if (clawback > 0) {
      await this.agents.post({
        agentId,
        kind: 'commission_reversal',
        magnitudeMinor: clawback,
        bookingId: input.bookingId,
        reference: `refund:${input.refundId}`,
      });
    }
    return true;
  }
}
