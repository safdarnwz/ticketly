import { Injectable } from '@nestjs/common';

import { UnitOfWork, type TransactionScope } from '@database';
import { newId } from '@kernel';

import type { InvoiceLine, PlatformDiscount } from '../domain/platform-invoice';

export interface PlatformInvoiceRow {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  periodFrom: string;
  periodTo: string;
  lines: InvoiceLine[];
  subtotalMinor: number;
  discountMinor: number;
  gstMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: Date;
}

export interface PlatformDiscountRow {
  id: string;
  tenantId: string | null;
  kind: 'percent' | 'flat';
  value: number;
  reason: string;
  validFrom: string;
  validTo: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const INVOICE_COLUMNS = `id, tenant_id AS "tenantId", invoice_number AS "invoiceNumber",
  period_from::text AS "periodFrom", period_to::text AS "periodTo", lines,
  subtotal_minor AS "subtotalMinor", discount_minor AS "discountMinor", gst_minor AS "gstMinor",
  total_minor AS "totalMinor", currency, created_at AS "createdAt"`;

const DISCOUNT_COLUMNS = `id, tenant_id AS "tenantId", kind, value::float8 AS value, reason,
  valid_from::text AS "validFrom", valid_to::text AS "validTo", revoked_at AS "revokedAt", created_at AS "createdAt"`;

/**
 * Platform → operator invoices and discounts. Platform-admin data spanning
 * every operator, so every call bypasses RLS.
 */
@Injectable()
export class PlatformInvoiceRepository {
  constructor(private readonly uow: UnitOfWork) {}

  run<T>(name: string, fn: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.uow.run({ name, bypassRls: true }, fn);
  }

  /** Billable usage of one operator in [from, to] (dates in UTC). */
  async usageLines(
    scope: TransactionScope,
    tenantId: string,
    from: string,
    to: string,
  ): Promise<InvoiceLine[]> {
    const { rows } = await scope.client.query<{
      kind: string;
      count: string;
      base: string;
      gst: string;
    }>(
      `SELECT 'booking_commission' AS kind, count(DISTINCT le.id) AS count,
              coalesce(sum(CASE WHEN lp.account = 'platform_revenue' THEN -lp.amount_minor END), 0) AS base,
              coalesce(sum(CASE WHEN lp.account = 'commission_tax_payable' THEN -lp.amount_minor END), 0) AS gst
         FROM ledger_postings lp JOIN ledger_entries le ON le.id = lp.entry_id
        WHERE lp.tenant_id = $1 AND lp.account IN ('platform_revenue', 'commission_tax_payable')
          AND lp.created_at >= $2::date AND lp.created_at < $3::date + 1
       UNION ALL
       SELECT kind, count(*), sum(amount_minor - gst_minor), sum(gst_minor)
         FROM platform_charges
        WHERE tenant_id = $1 AND kind <> 'settlement_shortfall'
          AND created_at >= $2::date AND created_at < $3::date + 1
        GROUP BY kind`,
      [tenantId, from, to],
    );
    return rows
      .map((r) => ({
        kind: r.kind,
        description: r.kind,
        count: Number(r.count),
        baseMinor: Number(r.base),
        gstMinor: Number(r.gst),
      }))
      .filter((l) => l.count > 0 && (l.baseMinor !== 0 || l.gstMinor !== 0));
  }

  /** Discounts for this operator (or every operator) valid on any day of the period. */
  async activeDiscounts(
    scope: TransactionScope,
    tenantId: string,
    from: string,
    to: string,
  ): Promise<PlatformDiscount[]> {
    const { rows } = await scope.client.query<PlatformDiscount>(
      `SELECT id, kind, value::float8 AS value FROM platform_discounts
        WHERE (tenant_id = $1 OR tenant_id IS NULL) AND revoked_at IS NULL
          AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to >= $2::date)
        ORDER BY created_at`,
      [tenantId, from, to],
    );
    return rows;
  }

  /** Next gapless number for the financial year (row-locked until the transaction ends). */
  async nextNumber(scope: TransactionScope, fy: string): Promise<number> {
    const { rows } = await scope.client.query<{ n: number }>(
      `INSERT INTO platform_invoice_sequences (financial_year, last_number) VALUES ($1, 1)
       ON CONFLICT (financial_year) DO UPDATE SET last_number = platform_invoice_sequences.last_number + 1
       RETURNING last_number AS n`,
      [fy],
    );
    return rows[0].n;
  }

  async findForPeriod(
    scope: TransactionScope,
    tenantId: string,
    from: string,
    to: string,
  ): Promise<PlatformInvoiceRow | null> {
    const { rows } = await scope.client.query<PlatformInvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM platform_invoices WHERE tenant_id = $1 AND period_from = $2 AND period_to = $3`,
      [tenantId, from, to],
    );
    return rows[0] ?? null;
  }

  async insert(
    scope: TransactionScope,
    inv: Omit<PlatformInvoiceRow, 'id' | 'createdAt' | 'currency'> & {
      discountIds: string[];
      createdBy: string | null;
    },
  ): Promise<string> {
    const id = newId();
    await scope.client.query(
      `INSERT INTO platform_invoices
         (id, tenant_id, invoice_number, period_from, period_to, lines, subtotal_minor, discount_minor,
          gst_minor, total_minor, discount_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        inv.tenantId,
        inv.invoiceNumber,
        inv.periodFrom,
        inv.periodTo,
        JSON.stringify(inv.lines),
        inv.subtotalMinor,
        inv.discountMinor,
        inv.gstMinor,
        inv.totalMinor,
        inv.discountIds,
        inv.createdBy,
      ],
    );
    return id;
  }

  async list(
    scope: TransactionScope,
    tenantId: string | null,
    limit: number,
  ): Promise<PlatformInvoiceRow[]> {
    const { rows } = await scope.client.query<PlatformInvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM platform_invoices
        WHERE $1::uuid IS NULL OR tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return rows;
  }

  async find(scope: TransactionScope, id: string): Promise<PlatformInvoiceRow | null> {
    const { rows } = await scope.client.query<PlatformInvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM platform_invoices WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createDiscount(
    scope: TransactionScope,
    d: {
      tenantId: string | null;
      kind: 'percent' | 'flat';
      value: number;
      reason: string;
      validFrom: string;
      validTo: string | null;
      createdBy: string | null;
    },
  ): Promise<string> {
    const id = newId();
    await scope.client.query(
      `INSERT INTO platform_discounts (id, tenant_id, kind, value, reason, valid_from, valid_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, d.tenantId, d.kind, d.value, d.reason, d.validFrom, d.validTo, d.createdBy],
    );
    return id;
  }

  async listDiscounts(
    scope: TransactionScope,
    tenantId: string | null,
  ): Promise<PlatformDiscountRow[]> {
    const { rows } = await scope.client.query<PlatformDiscountRow>(
      `SELECT ${DISCOUNT_COLUMNS} FROM platform_discounts
        WHERE $1::uuid IS NULL OR tenant_id = $1 OR tenant_id IS NULL ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  async revokeDiscount(scope: TransactionScope, id: string): Promise<boolean> {
    const { rowCount } = await scope.client.query(
      `UPDATE platform_discounts SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
