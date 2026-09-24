import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { newId, NotFoundError, requireTenantId, type LocalDate } from '@kernel';
import { EventBus } from '@messaging';

import { PlatformChargeRepository } from '../../../platform-settings';
import { settlementEntry } from '../../domain/ledger';
import { LedgerRepository } from '../../infrastructure/persistence/ledger.repository';
import { SettlementRepository } from '../../infrastructure/persistence/settlement.repository';

/**
 * Settlement — periodically pays out an operator's accrued payable.
 *
 * `generate` computes the settlement figures for a period directly from the
 * ledger (the source of truth), not by re-summing bookings — so a settlement
 * always reconciles with the books. Finalising posts a `settlement.paid` entry
 * moving `operator_payable → operator_wallet`, which zeroes the payable for the
 * settled amount and keeps the trial balance at zero.
 *
 * IMPORTANT — this is the INTERNAL accounting side only. "Finalised" means
 * "we have correctly computed and booked what we owe the operator", NOT "the
 * bank transfer happened". Publishing `settlement.finalised` here (rather
 * than importing TenancyModule directly, which would create a circular
 * module dependency — TenancyModule → BookingModule → PaymentModule) is what
 * lets a separate PayoutConsumer (worker) create the actual DISBURSEMENT
 * instruction, snapshotting the operator's bank details at that moment. See
 * apps/worker/src/consumers/payout.consumer.ts.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly settlements: SettlementRepository,
    private readonly charges: PlatformChargeRepository,
    private readonly ledger: LedgerRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
  ) {}

  /**
   * Draft a settlement for a period from ledger figures. Idempotent: a
   * (tenant, periodFrom, periodTo) that already has a settlement (of ANY
   * status — draft or already paid) returns the existing one rather than
   * inserting a duplicate. This is what makes it safe for the automated
   * weekly payout scheduler to re-run without risk — a retried job, a worker
   * restart mid-cycle, or a manual re-trigger for the same window can never
   * produce a second payout for money already settled.
   */
  async generate(
    periodFrom: LocalDate,
    periodTo: LocalDate,
  ): Promise<{ settlementId: string; netMinor: number }> {
    const tenantId = requireTenantId();

    const existing = await this.settlements.findForPeriod(tenantId, periodFrom, periodTo);
    if (existing) return { settlementId: existing.id, netMinor: existing.netMinor };

    const figures = await this.settlements.ledgerFigures(tenantId, periodFrom, periodTo);
    // Outstanding one-time platform charges (the per-bus fee, an earlier
    // shortfall, …) are netted against THIS payout, whichever period they were
    // charged in — they are not period-bound like booking commission.
    const chargesMinor = await this.charges.pendingTotalMinor(tenantId);

    // operator_payable already nets booking commission and refund clawbacks.
    // A settlement never goes negative, but what it cannot cover is not
    // written off: when charges exceed gross (or gross itself is negative
    // after a heavy-refund period), the difference becomes a new pending
    // 'settlement_shortfall' charge that the next settlement deducts.
    const shortfall = Math.max(0, chargesMinor - figures.grossMinor);
    const net = Math.max(0, figures.grossMinor - chargesMinor);

    const id = newId();
    // The SELECT above handles a sequential retry; the unique (tenant, period)
    // index + ON CONFLICT handles two concurrent generate() calls — the loser
    // gets null here and returns the winner's row below.
    const inserted = await this.uow.run({ name: 'settlement.generate', tenantId }, async () => {
      const wonId = await this.settlements.insertDraft({
        id,
        tenantId,
        periodFrom,
        periodTo,
        figures,
        netMinor: net,
      });
      // Only the call that actually inserted may add the shortfall, or the
      // same debt would be counted twice.
      if (wonId && shortfall > 0)
        await this.charges.add({
          tenantId,
          kind: 'settlement_shortfall',
          amountMinor: shortfall,
          description: `Refunds exceeded gross for ${periodFrom} to ${periodTo} — carried to next settlement`,
        });
      return wonId;
    });
    if (!inserted) {
      const winner = await this.settlements.findForPeriod(tenantId, periodFrom, periodTo);
      if (winner) return { settlementId: winner.id, netMinor: winner.netMinor };
    }
    return { settlementId: id, netMinor: net };
  }

  /** Finalise + pay: post the ledger settlement entry, mark paid, settle the charges it accounted for. */
  async finalise(settlementId: string): Promise<void> {
    const tenantId = requireTenantId();
    await this.uow.run({ name: 'settlement.finalise', tenantId }, async () => {
      const row = await this.settlements.lockForUpdate(tenantId, settlementId);
      if (!row) throw new NotFoundError('Settlement', settlementId);
      if (row.status !== 'draft') return; // idempotent

      if (row.netMinor > 0) {
        await this.ledger.post(
          settlementEntry({
            currency: row.currency as never,
            settlementId,
            operatorId: tenantId,
            amountMinor: row.netMinor,
          }),
        );
      }
      // generate() accounted for every charge pending before the settlement
      // (deducted, or carried in a new shortfall charge); settle exactly those.
      await this.charges.settlePendingBefore(tenantId, settlementId);
      await this.settlements.markPaid(tenantId, settlementId);

      // Hand off to disbursement — only a non-zero payout needs a bank transfer.
      if (row.netMinor > 0) {
        this.events.publish({
          type: 'settlement.finalised',
          aggregateType: 'settlement',
          aggregateId: settlementId,
          payload: { tenantId, settlementId, amountMinor: row.netMinor, currency: row.currency },
        });
      }
    });
  }

  /**
   * Generate + finalise in one call — what the automated weekly payout
   * scheduler uses. Must run inside `runAsTenant` (or an equivalent bound
   * tenant context) since both steps are tenant-scoped; this method itself
   * doesn't bind one; see PayoutScheduler.
   */
  async runPayout(
    periodFrom: LocalDate,
    periodTo: LocalDate,
  ): Promise<{ settlementId: string; netMinor: number }> {
    const { settlementId, netMinor } = await this.generate(periodFrom, periodTo);
    await this.finalise(settlementId);
    return { settlementId, netMinor };
  }
}
