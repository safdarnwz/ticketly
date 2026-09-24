import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type DomainEvent } from '@kernel';
import { Logger } from '@observability';

import { PayoutRepository } from '@api/modules/tenancy/infrastructure/persistence/payout.repository';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * Turns "settlement finalised" (internal accounting: we now owe the operator
 * X) into an actual DISBURSEMENT instruction — the thing that eventually
 * becomes a line in a bank payout file. Deliberately a separate consumer
 * (not inline in SettlementService) to avoid a circular module dependency —
 * see settlement.service.ts's doc comment — and because "compute what we
 * owe" and "prepare to actually pay it" are genuinely different concerns
 * that can fail independently (e.g. missing bank details shouldn't roll back
 * the settlement itself).
 */
@Injectable()
export class PayoutConsumer implements OnModuleInit {
  private readonly log: Logger;

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly payouts: PayoutRepository,
    logger: Logger,
  ) {
    this.log = logger.forContext('PayoutConsumer');
  }

  onModuleInit(): void {
    this.dispatcher.register(this.handler());
  }

  private handler(): EventHandler {
    return {
      eventType: 'settlement.finalised',
      handle: async (event: DomainEvent) => {
        const payload = event.payload as { tenantId: string; settlementId: string; amountMinor: number; currency: string };
        try {
          await this.payouts.createFromSettlement(payload.tenantId, payload.settlementId, payload.amountMinor, payload.currency);
        } catch (err) {
          // Most likely cause: operator has no bank details on file yet.
          // Logged loudly rather than thrown — throwing would make the
          // outbox retry forever for an operator who simply hasn't set up
          // their bank account, which never resolves itself. Ops needs to
          // follow up with the operator; the settlement itself still stands.
          this.log.error({ err, ...payload }, 'could not create payout instruction — operator likely missing bank details');
        }
      },
    };
  }
}
