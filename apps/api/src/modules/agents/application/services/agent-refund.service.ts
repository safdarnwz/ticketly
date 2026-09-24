import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  commissionClawbackMinor,
  RefundCreditorRegistry,
  type RefundCreditInput,
  type RefundCreditor,
} from '../../../refunds';
import { AgentRepository } from '../../infrastructure/persistence/agent.repository';

/**
 * Credits a refund for an AGENT-sold booking back to that agent's account
 * (the operator holds the cash, so a gateway refund would be impossible and
 * the wrong actor) and claws back the same share of the agent's commission.
 *
 * Registered with the refunds module's RefundCreditorRegistry for sales
 * whose payment gateway is 'agent'. Must run inside the caller's unit of work.
 */
@Injectable()
export class AgentRefundService implements RefundCreditor, OnModuleInit {
  readonly gateway = 'agent';
  readonly collectedBy = 'operator';
  readonly destination = 'agent_account';
  readonly channel = 'agent';
  readonly missingAccountReason = 'agent booking without an agent account';

  constructor(
    private readonly agents: AgentRepository,
    private readonly registry: RefundCreditorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** @returns null if the booking was not sold by an agent. Idempotent per refund id. */
  async creditRefund(input: RefundCreditInput): Promise<{ clawbackMinor: number } | null> {
    const agentId = await this.agents.agentForBooking(input.bookingId);
    if (!agentId) return null;
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
    return { clawbackMinor: clawback };
  }
}
