import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { newId } from '@kernel';

export interface PayoutInstruction {
  id: string;
  tenantId: string;
  settlementId: string;
  amountMinor: number;
  currency: string;
  beneficiaryName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  status: 'pending' | 'in_batch' | 'sent' | 'confirmed' | 'failed';
  createdAt: Date;
}

/**
 * The DISBURSEMENT side of a payout — separate from SettlementService's
 * internal accounting (see settlement.service.ts's doc comment). Created by
 * PayoutConsumer reacting to `settlement.finalised`, snapshotting the
 * operator's bank details AT THAT MOMENT — a later bank-detail change must
 * never retroactively rewrite an instruction already created (let alone one
 * already sent to the bank).
 */
export interface PendingBankChange {
  id: string;
  tenantId: string;
  tenantName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
  createdAt: Date;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Create the disbursement instruction for a just-finalised settlement.
   * Requires the operator to have bank details on file — if they don't,
   * this throws rather than silently creating an instruction nobody can
   * actually pay, so the failure is visible (worker logs + retries the
   * event) instead of a payout quietly vanishing.
   */
  async createFromSettlement(
    tenantId: string,
    settlementId: string,
    amountMinor: number,
    currency: string,
  ): Promise<string> {
    return this.uow.run({ name: 'payout.create', bypassRls: true }, async (scope) => {
      const bank = (
        await scope.client.query<{
          bank_account_holder: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
        }>(
          `SELECT bank_account_holder, bank_account_number, bank_ifsc FROM tenants WHERE id = $1`,
          [tenantId],
        )
      ).rows[0];
      if (!bank?.bank_account_number || !bank.bank_ifsc || !bank.bank_account_holder) {
        throw new Error(
          `Operator ${tenantId} has no bank details on file — cannot create payout instruction for settlement ${settlementId}`,
        );
      }
      const id = newId();
      await scope.client.query(
        `INSERT INTO payout_instructions (id, tenant_id, settlement_id, amount_minor, currency, beneficiary_name, bank_account_number, bank_ifsc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (settlement_id) DO NOTHING`,
        [
          id,
          tenantId,
          settlementId,
          amountMinor,
          currency,
          bank.bank_account_holder,
          bank.bank_account_number,
          bank.bank_ifsc,
        ],
      );
      return id;
    });
  }

  /** Every payout awaiting disbursement, oldest first — for the bank-file export. */
  async listPending(): Promise<PayoutInstruction[]> {
    return this.uow.run({ name: 'payout.listPending', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<PayoutInstruction>(
        `SELECT id, tenant_id AS "tenantId", settlement_id AS "settlementId", amount_minor AS "amountMinor", currency,
                beneficiary_name AS "beneficiaryName", bank_account_number AS "bankAccountNumber", bank_ifsc AS "bankIfsc",
                status, created_at AS "createdAt"
           FROM payout_instructions WHERE status = 'pending' ORDER BY created_at`,
      );
      return result.rows;
    });
  }

  async listAll(limit = 200): Promise<PayoutInstruction[]> {
    return this.uow.run({ name: 'payout.listAll', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<PayoutInstruction>(
        `SELECT id, tenant_id AS "tenantId", settlement_id AS "settlementId", amount_minor AS "amountMinor", currency,
                beneficiary_name AS "beneficiaryName", bank_account_number AS "bankAccountNumber", bank_ifsc AS "bankIfsc",
                status, created_at AS "createdAt"
           FROM payout_instructions ORDER BY created_at DESC LIMIT $1`,
        [Math.min(limit, 500)],
      );
      return result.rows;
    });
  }

  /** Mark a batch of instructions as included in a generated bank file — the ONE human step (upload the file) still has to happen after this. */
  async markInBatch(ids: string[], batchId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.uow.run({ name: 'payout.markInBatch', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE payout_instructions SET status = 'in_batch', batch_id = $2 WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
        [ids, batchId],
      );
    });
  }

  /** Staff confirms the bank file was uploaded/submitted. */
  async markSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.uow.run({ name: 'payout.markSent', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE payout_instructions SET status = 'sent', sent_at = now() WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    });
  }

  /** Staff confirms the bank has actually completed the transfer (from the bank statement/portal). */
  async markConfirmed(id: string): Promise<void> {
    await this.uow.run({ name: 'payout.markConfirmed', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE payout_instructions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [id],
      );
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.uow.run({ name: 'payout.markFailed', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE payout_instructions SET status = 'failed', failure_reason = $2 WHERE id = $1`,
        [id, reason],
      );
    });
  }

  /* ── Bank-detail CHANGE requests ────────────────────────────────────────
   * The account actually used for payouts (tenants.bank_account_*) is never
   * touched by these directly — only approveBankChange() copies a request's
   * values across, and only a platform admin can call that. This is the
   * anti-fraud control: an operator changing their OWN bank account must not
   * be able to redirect their own payouts without a human on the platform
   * side looking at it first.
   */

  /** Operator submits a change. Supersedes any earlier pending request for the same tenant (one at a time — see the partial unique index). */
  async submitBankChangeRequest(
    tenantId: string,
    submittedBy: string | null,
    input: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string },
  ): Promise<string> {
    return this.uow.run({ name: 'payout.submitBankChange', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE bank_account_change_requests SET status = 'rejected', rejection_reason = 'superseded by a newer request', reviewed_at = now()
          WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId],
      );
      const id = newId();
      await scope.client.query(
        `INSERT INTO bank_account_change_requests (id, tenant_id, account_holder, account_number, ifsc, bank_name, submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          tenantId,
          input.accountHolder,
          input.accountNumber,
          input.ifsc.toUpperCase(),
          input.bankName ?? null,
          submittedBy,
        ],
      );
      return id;
    });
  }

  /** The operator takes back its pending change; false when there is none. */
  async withdrawBankChangeRequest(tenantId: string): Promise<boolean> {
    return this.uow.run({ name: 'payout.withdrawBankChange', bypassRls: true }, async (scope) => {
      const r = await scope.client.query(
        `UPDATE bank_account_change_requests SET status = 'withdrawn', reviewed_at = now()
          WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  /** The operator's own pending request, if any — so their bank-details page can show "under review". */
  async pendingBankChangeRequest(tenantId: string): Promise<{
    id: string;
    accountHolder: string;
    accountNumber: string;
    ifsc: string;
    createdAt: Date;
  } | null> {
    return this.uow.run({ name: 'payout.pendingBankChange', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<{
        id: string;
        account_holder: string;
        account_number: string;
        ifsc: string;
        created_at: Date;
      }>(
        `SELECT id, account_holder, account_number, ifsc, created_at FROM bank_account_change_requests
          WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [tenantId],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            accountHolder: row.account_holder,
            accountNumber: row.account_number,
            ifsc: row.ifsc,
            createdAt: row.created_at,
          }
        : null;
    });
  }

  /** Every pending change request, across every operator — for the super-admin review queue. */
  async listPendingBankChangeRequests(): Promise<PendingBankChange[]> {
    return this.uow.run(
      { name: 'payout.listPendingBankChanges', bypassRls: true },
      async (scope) => {
        const result = await scope.client.query<PendingBankChange>(
          `SELECT r.id, r.tenant_id AS "tenantId", t.display_name AS "tenantName", r.account_holder AS "accountHolder",
                r.account_number AS "accountNumber", r.ifsc, r.bank_name AS "bankName", r.created_at AS "createdAt"
           FROM bank_account_change_requests r JOIN tenants t ON t.id = r.tenant_id
          WHERE r.status = 'pending' ORDER BY r.created_at`,
        );
        return result.rows;
      },
    );
  }

  /** Approve: copy the requested details into the tenant's ACTIVE payout account, atomically with marking the request approved. */
  async approveBankChange(requestId: string, reviewerId: string | null): Promise<void> {
    await this.uow.run({ name: 'payout.approveBankChange', bypassRls: true }, async (scope) => {
      const req = (
        await scope.client.query<{
          tenant_id: string;
          account_holder: string;
          account_number: string;
          ifsc: string;
          bank_name: string | null;
          status: string;
        }>(
          `SELECT tenant_id, account_holder, account_number, ifsc, bank_name, status FROM bank_account_change_requests WHERE id = $1 FOR UPDATE`,
          [requestId],
        )
      ).rows[0];
      if (!req) throw new Error('Bank change request not found');
      if (req.status !== 'pending') return; // idempotent — already reviewed

      await scope.client.query(
        `UPDATE tenants SET bank_account_holder = $2, bank_account_number = $3, bank_ifsc = $4, bank_name = $5, bank_details_updated_at = now()
          WHERE id = $1`,
        [req.tenant_id, req.account_holder, req.account_number, req.ifsc, req.bank_name],
      );
      await scope.client.query(
        `UPDATE bank_account_change_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
        [requestId, reviewerId],
      );
    });
  }

  async rejectBankChange(
    requestId: string,
    reviewerId: string | null,
    reason: string,
  ): Promise<void> {
    await this.uow.run({ name: 'payout.rejectBankChange', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE bank_account_change_requests SET status = 'rejected', rejection_reason = $3, reviewed_by = $2, reviewed_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [requestId, reviewerId, reason],
      );
    });
  }
}
