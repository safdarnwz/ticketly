import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { newId, requireTenantId, type LocalDate } from '@kernel';
import { DatabaseService } from '@database';
import { EventBus } from '@messaging';

import { LedgerAccounts, settlementEntry } from '../../domain/ledger';
import { LedgerRepository } from '../../infrastructure/persistence/ledger.repository';

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
    private readonly db: DatabaseService,
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
  async generate(periodFrom: LocalDate, periodTo: LocalDate): Promise<{ settlementId: string; netMinor: number }> {
    const tenantId = requireTenantId();

    const existing = await this.db.queryOne<{ id: string; net_minor: number }>(
      `SELECT id, net_minor FROM settlements WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3`,
      [tenantId, periodFrom, periodTo],
      { name: 'settlement.existing', primary: true },
    );
    if (existing) return { settlementId: existing.id, netMinor: Number(existing.net_minor) };

    // Figures straight from the ledger for the period.
    const figures = await this.db.queryOne<{ gross: number; commission: number; refunds: number; bookings: number }>(
      `SELECT
         coalesce(sum(CASE WHEN account = $2 THEN -amount_minor ELSE 0 END), 0)::bigint AS gross,
         coalesce(sum(CASE WHEN account = $3 THEN -amount_minor ELSE 0 END), 0)::bigint AS commission,
         coalesce(sum(CASE WHEN account = $4 THEN -amount_minor ELSE 0 END), 0)::bigint AS refunds,
         count(DISTINCT le.source_id)::int AS bookings
       FROM ledger_postings lp
       JOIN ledger_entries le ON le.id = lp.entry_id
      WHERE lp.tenant_id = $1 AND le.created_at::date BETWEEN $5 AND $6`,
      [tenantId, LedgerAccounts.OPERATOR_PAYABLE, LedgerAccounts.PLATFORM_REVENUE, LedgerAccounts.CUSTOMER_REFUNDS, periodFrom, periodTo],
      { name: 'settlement.figures', primary: true },
    );

    // Any still-outstanding one-time platform charges (the per-bus fee, etc.)
    // get netted against THIS payout, whichever period they were charged in —
    // they're not period-bound like booking commission is.
    const pendingCharges = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(amount_minor), 0) AS total FROM platform_charges WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
      { name: 'settlement.pendingCharges', primary: true },
    );
    const platformChargesMinor = Number(pendingCharges?.total ?? 0);

    const gross = figures?.gross ?? 0;
    const commission = figures?.commission ?? 0;
    const refunds = figures?.refunds ?? 0;
    // operator_payable already nets booking commission; refunds reduce it via
    // clawback; one-time platform charges (per-bus fee) are deducted here,
    // clamped so a settlement never goes negative — if charges exceed what's
    // owed this period, the excess simply rolls into the NEXT settlement
    // (the charge rows stay 'pending' until finalise() has enough to cover them).
    // Clamped so a settlement never goes negative — but the excess, when
    // gross itself is already negative (a heavy-refund period can easily
    // outweigh a quiet period's new bookings, since operator_payable
    // already nets refund clawbacks into gross), is NOT simply discarded.
    // Math.max(0, ...) alone would silently write off real money the
    // operator was already paid out in a PRIOR settlement for bookings
    // that have since been cancelled — a genuine platform loss repeated
    // every time this occurs, not a rare edge case for any operator with
    // a high-cancellation week. The shortfall becomes a new pending
    // platform_charges row instead, reusing the exact same "rolls into
    // the next settlement that has enough to cover it" mechanism the
    // one-time per-bus fee already relies on below.
    const shortfall = Math.max(0, platformChargesMinor - gross);
    const net = Math.max(0, gross - platformChargesMinor);

    const id = newId();
    // ON CONFLICT belt-and-suspenders: the SELECT-check above closes the gap
    // for a sequential retry, but two genuinely concurrent generate() calls
    // for the same (tenant, period) could both pass that check before either
    // commits — the unique index (migration 0022) is what actually prevents
    // two rows; this just makes losing that race a clean "return the winner's
    // row" instead of a thrown constraint-violation error.
    const inserted = await this.uow.run({ name: 'settlement.generate', tenantId }, async (scope) => {
      const result = await scope.client.query<{ id: string }>(
        `INSERT INTO settlements (id, tenant_id, period_from, period_to, gross_minor, commission_minor, refunds_minor, net_minor, booking_count, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft')
         ON CONFLICT (tenant_id, period_from, period_to) DO NOTHING
         RETURNING id`,
        [id, tenantId, periodFrom, periodTo, gross, commission, refunds, net, figures?.bookings ?? 0],
      );
      const wonId = result.rows[0]?.id ?? null;
      // Same transaction, and gated on ACTUALLY having won the insert race
      // above — a concurrent generate() call that loses that race must
      // never ALSO insert a shortfall charge, or the same debt gets
      // double-counted (one real settlement row, two shortfall charges).
      if (wonId && shortfall > 0) {
        await scope.client.query(
          `INSERT INTO platform_charges (id, tenant_id, kind, amount_minor, status, description)
           VALUES ($1, $2, 'settlement_shortfall', $3, 'pending', $4)`,
          [newId(), tenantId, shortfall, `Refunds exceeded gross for ${periodFrom} to ${periodTo} — carried to next settlement`],
        );
      }
      return wonId;
    });
    if (!inserted) {
      // Lost the race — fetch whichever row actually landed.
      const winner = await this.db.queryOne<{ id: string; net_minor: number }>(
        `SELECT id, net_minor FROM settlements WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3`,
        [tenantId, periodFrom, periodTo],
        { name: 'settlement.raceWinner', primary: true },
      );
      if (winner) return { settlementId: winner.id, netMinor: Number(winner.net_minor) };
    }
    return { settlementId: id, netMinor: net };
  }

  /** Finalise + pay: post the ledger settlement entry, mark paid, and settle any platform charges this payout covered. */
  async finalise(settlementId: string): Promise<void> {
    const tenantId = requireTenantId();
    await this.uow.run({ name: 'settlement.finalise', tenantId }, async (scope) => {
      const row = (await scope.client.query<{ net_minor: number; gross_minor: number; currency: string; status: string }>(
        `SELECT net_minor, gross_minor, currency, status FROM settlements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, settlementId],
      )).rows[0];
      if (!row) throw new Error('Settlement not found');
      if (row.status !== 'draft') return; // idempotent

      if (row.net_minor > 0) {
        await this.ledger.post(settlementEntry({
          currency: row.currency as never,
          settlementId,
          operatorId: tenantId,
          amountMinor: row.net_minor,
        }));
      }

      // Settle whatever pending platform charges this payout had capacity to
      // cover (gross_minor - net_minor is exactly what got deducted for them
      // in generate()) — oldest first, so a partially-covered charge still
      // waits cleanly for the next settlement rather than leaving gaps.
      const covered = row.gross_minor - row.net_minor;
      if (covered > 0) {
        await scope.client.query(
          `UPDATE platform_charges SET status = 'settled', settlement_id = $2
             WHERE id IN (
               SELECT id FROM platform_charges WHERE tenant_id = $1 AND status = 'pending'
               ORDER BY created_at LIMIT 10000
             )`,
          [tenantId, settlementId],
        );
      }

      await scope.client.query(
        `UPDATE settlements SET status = 'paid', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, settlementId],
      );

      // Hand off to disbursement — a payout instruction only makes sense for
      // a non-zero payout (net_minor === 0 means charges fully absorbed the
      // gross this period; nothing to actually send to the bank).
      if (row.net_minor > 0) {
        this.events.publish({
          type: 'settlement.finalised',
          aggregateType: 'settlement',
          aggregateId: settlementId,
          payload: { tenantId, settlementId, amountMinor: row.net_minor, currency: row.currency },
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
  async runPayout(periodFrom: LocalDate, periodTo: LocalDate): Promise<{ settlementId: string; netMinor: number }> {
    const { settlementId, netMinor } = await this.generate(periodFrom, periodTo);
    await this.finalise(settlementId);
    return { settlementId, netMinor };
  }
}
