import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { type LocalDate, type TenantId } from '@kernel';

import { LedgerAccounts } from '../../domain/ledger';

export interface SettlementFigures {
  grossMinor: number;
  commissionMinor: number;
  refundsMinor: number;
  bookingCount: number;
}

export interface SettlementForUpdate {
  netMinor: number;
  grossMinor: number;
  currency: string;
  status: string;
}

/** settlements — an operator's periodic payout, computed from the ledger. */
@Injectable()
export class SettlementRepository {
  constructor(private readonly db: DatabaseService) {}

  async findForPeriod(
    tenantId: TenantId,
    periodFrom: LocalDate,
    periodTo: LocalDate,
  ): Promise<{ id: string; netMinor: number } | null> {
    const row = await this.db.queryOne<{ id: string; net_minor: string }>(
      `SELECT id, net_minor FROM settlements WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3`,
      [tenantId, periodFrom, periodTo],
      { name: 'settlement.findForPeriod', primary: true },
    );
    return row ? { id: row.id, netMinor: Number(row.net_minor) } : null;
  }

  /** Period figures straight from the ledger (the source of truth). */
  async ledgerFigures(
    tenantId: TenantId,
    periodFrom: LocalDate,
    periodTo: LocalDate,
  ): Promise<SettlementFigures> {
    const row = await this.db.queryOne<{
      gross: string;
      commission: string;
      refunds: string;
      bookings: number;
    }>(
      `SELECT
         coalesce(sum(CASE WHEN account = $2 THEN -amount_minor ELSE 0 END), 0)::bigint AS gross,
         coalesce(sum(CASE WHEN account = $3 THEN -amount_minor ELSE 0 END), 0)::bigint AS commission,
         coalesce(sum(CASE WHEN account = $4 THEN -amount_minor ELSE 0 END), 0)::bigint AS refunds,
         count(DISTINCT le.source_id)::int AS bookings
       FROM ledger_postings lp
       JOIN ledger_entries le ON le.id = lp.entry_id
      WHERE lp.tenant_id = $1 AND le.created_at::date BETWEEN $5 AND $6`,
      [
        tenantId,
        LedgerAccounts.OPERATOR_PAYABLE,
        LedgerAccounts.PLATFORM_REVENUE,
        LedgerAccounts.CUSTOMER_REFUNDS,
        periodFrom,
        periodTo,
      ],
      { name: 'settlement.figures', primary: true },
    );
    return {
      grossMinor: Number(row?.gross ?? 0),
      commissionMinor: Number(row?.commission ?? 0),
      refundsMinor: Number(row?.refunds ?? 0),
      bookingCount: row?.bookings ?? 0,
    };
  }

  /**
   * Insert a draft settlement; returns its id, or null when a settlement for
   * the same (tenant, period) already exists (a concurrent generate won).
   */
  async insertDraft(s: {
    id: string;
    tenantId: TenantId;
    periodFrom: LocalDate;
    periodTo: LocalDate;
    figures: SettlementFigures;
    netMinor: number;
  }): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO settlements (id, tenant_id, period_from, period_to, gross_minor, commission_minor,
                                refunds_minor, net_minor, booking_count, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft')
       ON CONFLICT (tenant_id, period_from, period_to) DO NOTHING
       RETURNING id`,
      [
        s.id,
        s.tenantId,
        s.periodFrom,
        s.periodTo,
        s.figures.grossMinor,
        s.figures.commissionMinor,
        s.figures.refundsMinor,
        s.netMinor,
        s.figures.bookingCount,
      ],
      { name: 'settlement.insertDraft', primary: true },
    );
    return row?.id ?? null;
  }

  async lockForUpdate(
    tenantId: TenantId,
    settlementId: string,
  ): Promise<SettlementForUpdate | null> {
    const row = await this.db.queryOne<{
      net_minor: string;
      gross_minor: string;
      currency: string;
      status: string;
    }>(
      `SELECT net_minor, gross_minor, currency, status
         FROM settlements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, settlementId],
      { name: 'settlement.lock', primary: true },
    );
    return row
      ? {
          netMinor: Number(row.net_minor),
          grossMinor: Number(row.gross_minor),
          currency: row.currency,
          status: row.status,
        }
      : null;
  }

  async markPaid(tenantId: TenantId, settlementId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE settlements SET status = 'paid', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, settlementId],
      { name: 'settlement.markPaid', primary: true },
    );
  }
}
