import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { currentTransaction, DatabaseService } from '@database';
import { Money, newId, requireTenantId, type CurrencyCode, type LocalDate } from '@kernel';

import { LedgerTransaction } from '../../domain/ledger';

/**
 * Ledger persistence. `post` writes an entry + its postings inside the current
 * transaction, so the accounting is atomic with the business change that caused
 * it (a capture's postings commit with the booking's status change, never
 * separately). The DB's deferred balance trigger is the final backstop.
 */
@Injectable()
export class LedgerRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
  ) {}

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

  /**
   * The journal: every entry with its postings, newest first, for the operator's
   * own calendar days `from`..`to`. Booking entries carry the booking's PNR so a
   * finance clerk can trace a figure back to the ticket. Paged by entry id
   * (time-ordered uuid v7): pass the last id seen as `before`.
   */
  async journal(q: {
    from: LocalDate;
    to: LocalDate;
    type?: string;
    pnr?: string;
    before?: string;
    limit: number;
  }): Promise<{ items: JournalEntry[]; nextBefore: string | null }> {
    const rows = await this.db.query<JournalEntry>(
      `SELECT le.id, le.entry_type AS "type", le.currency, le.source_type AS "sourceType",
              le.source_id AS "sourceId", le.created_at AS "createdAt", b.pnr,
              coalesce((SELECT json_agg(json_build_object('account', lp.account,
                         'amountMinor', lp.amount_minor, 'ref', lp.ref) ORDER BY lp.amount_minor DESC)
                          FROM ledger_postings lp WHERE lp.entry_id = le.id), '[]'::json) AS postings
         FROM ledger_entries le
         LEFT JOIN bookings b ON le.source_type = 'booking' AND b.tenant_id = le.tenant_id
                             AND b.id::text = le.source_id
        WHERE le.tenant_id = $1
          AND (le.created_at AT TIME ZONE $2)::date BETWEEN $3 AND $4
          AND ($5::text IS NULL OR le.entry_type = $5)
          AND ($6::text IS NULL OR upper(b.pnr) = upper($6))
          AND ($7::uuid IS NULL OR le.id < $7)
        ORDER BY le.id DESC
        LIMIT $8`,
      [
        requireTenantId(),
        this.config.domain.timezone,
        q.from,
        q.to,
        q.type ?? null,
        q.pnr ?? null,
        q.before ?? null,
        q.limit + 1,
      ],
      { name: 'ledger.journal' },
    );
    const more = rows.length > q.limit;
    const items = more ? rows.slice(0, q.limit) : rows;
    for (const e of items) for (const p of e.postings) p.amountMinor = Number(p.amountMinor);
    return { items, nextBefore: more ? items[items.length - 1]!.id : null };
  }
}

export interface JournalEntry {
  id: string;
  type: string;
  currency: string;
  sourceType: string;
  sourceId: string;
  createdAt: Date;
  pnr: string | null;
  postings: { account: string; amountMinor: number; ref: string | null }[];
}
