import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

/**
 * platform_charges — what an operator owes the platform outside booking
 * commission (per-bus fee, SMS/WhatsApp fees, route promotions, a settlement
 * shortfall carried forward). Pending charges are netted against the
 * operator's next settlement. A negative amount is a credit.
 */
@Injectable()
export class PlatformChargeRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Add a pending charge. With a `reference`, a second charge of the same kind
   * for the same thing is ignored, so a retried call never double-charges;
   * returns null in that case. (The unique index is partial — `WHERE
   * reference_id IS NOT NULL` — so ON CONFLICT must repeat the predicate or
   * Postgres rejects the statement.)
   */
  async add(c: {
    tenantId: string;
    kind: string;
    amountMinor: number;
    description?: string;
    currency?: string;
    reference?: { type: string; id: string };
    /** When the amount includes GST: the fee before tax and the tax. */
    tax?: { baseMinor: number; gstMinor: number };
  }): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO platform_charges
         (id, tenant_id, kind, reference_type, reference_id, amount_minor, currency,
          base_minor, gst_minor, status, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
       ON CONFLICT (kind, reference_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        newId(),
        c.tenantId,
        c.kind,
        c.reference?.type ?? null,
        c.reference?.id ?? null,
        c.amountMinor,
        c.currency ?? 'INR',
        c.tax?.baseMinor ?? c.amountMinor,
        c.tax?.gstMinor ?? 0,
        c.description ?? null,
      ],
      { name: 'platformCharge.add', primary: true },
    );
    return row?.id ?? null;
  }

  async pendingTotalMinor(tenantId: string): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(amount_minor), 0) AS total
         FROM platform_charges WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
      { name: 'platformCharge.pendingTotal', primary: true },
    );
    return Number(row?.total ?? 0);
  }

  /**
   * Lower a charge that has not been settled yet; false when it was already
   * settled (then the caller credits the next settlement instead).
   */
  async reducePending(
    id: string,
    tenantId: string,
    amountMinor: number,
    note: string,
  ): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE platform_charges SET amount_minor = $3, description = coalesce(description, '') || $4
        WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [id, tenantId, amountMinor, note],
      { name: 'platformCharge.reducePending', primary: true },
    );
    return n > 0;
  }

  /**
   * Mark settled every charge that was pending before the settlement was
   * created. A charge written in the settlement's own transaction (same
   * created_at — its shortfall carry-forward) stays pending.
   */
  async settlePendingBefore(tenantId: string, settlementId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE platform_charges SET status = 'settled', settlement_id = $2
        WHERE tenant_id = $1 AND status = 'pending'
          AND created_at < (SELECT created_at FROM settlements WHERE id = $2)`,
      [tenantId, settlementId],
      { name: 'platformCharge.settle', primary: true },
    );
  }
}
