import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { Money, newId, requireTenantId, type CurrencyCode } from '@kernel';

import { LedgerTransaction } from '../../domain/ledger';

/**
 * Ledger persistence. `post` writes an entry + its postings inside the current
 * transaction, so the accounting is atomic with the business change that caused
 * it (a capture's postings commit with the booking's status change, never
 * separately). The DB's deferred balance trigger is the final backstop.
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly db: DatabaseService) {}

  async post(tx: LedgerTransaction): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('Ledger post must run inside a transaction');
    const tenantId = requireTenantId();
    const entryId = newId();

    await scope.client.query(
      `INSERT INTO ledger_entries (id, tenant_id, entry_type, currency, source_type, source_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [entryId, tenantId, tx.type, tx.currency, tx.sourceType, tx.sourceId],
    );
    for (const p of tx.postings) {
      await scope.client.query(
        `INSERT INTO ledger_postings (id, entry_id, tenant_id, account, amount_minor, ref)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(), entryId, tenantId, p.account, p.amountMinor, p.ref ?? null],
      );
    }
  }

  /** Current balance of an account (optionally for one operator ref). */
  async balance(account: string, ref?: string, currency: CurrencyCode = 'INR'): Promise<Money> {
    const row = await this.db.queryOne<{ bal: number }>(
      `SELECT coalesce(sum(amount_minor), 0)::bigint AS bal FROM ledger_postings
        WHERE tenant_id = $1 AND account = $2 ${ref ? 'AND ref = $3' : ''}`,
      ref ? [requireTenantId(), account, ref] : [requireTenantId(), account],
      { name: 'ledger.balance' },
    );
    // Liability/income accounts carry credit (negative) balances; return the
    // magnitude so callers read a positive "amount owed / earned".
    return Money.of(Math.abs(row?.bal ?? 0), currency);
  }

  /** Signed balance (for reconciliation / trial balance). */
  async signedBalance(account: string, ref?: string): Promise<number> {
    const row = await this.db.queryOne<{ bal: number }>(
      `SELECT coalesce(sum(amount_minor), 0)::bigint AS bal FROM ledger_postings
        WHERE tenant_id = $1 AND account = $2 ${ref ? 'AND ref = $3' : ''}`,
      ref ? [requireTenantId(), account, ref] : [requireTenantId(), account],
      { name: 'ledger.signedBalance' },
    );
    return row?.bal ?? 0;
  }

  /**
   * Trial balance: every account's net. In a correct double-entry system the
   * grand total across all accounts is ALWAYS zero — a non-zero total means the
   * books are broken, which is the single most important thing to monitor.
   */
  async trialBalance(): Promise<{ account: string; balance: number }[]> {
    return this.db.query<{ account: string; balance: number }>(
      `SELECT account, sum(amount_minor)::bigint AS balance FROM ledger_postings
        WHERE tenant_id = $1 GROUP BY account ORDER BY account`,
      [requireTenantId()],
      { name: 'ledger.trialBalance' },
    );
  }
}
