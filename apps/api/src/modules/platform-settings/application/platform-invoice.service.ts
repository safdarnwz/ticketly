import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, NotFoundError } from '@kernel';

import {
  INVOICE_LINE_LABELS,
  financialYear,
  invoiceTotals,
  platformInvoiceNumber,
} from '../domain/platform-invoice';
import {
  PlatformInvoiceRepository,
  type PlatformDiscountRow,
  type PlatformInvoiceRow,
} from '../infrastructure/platform-invoice.repository';

/**
 * The platform's invoices to operators (#100) and the discounts on them
 * (#101). An invoice covers one operator and one period: booking commission
 * plus the platform charges raised in it (bus registration, SMS / WhatsApp,
 * sponsored listings), with the discounts valid in that period applied.
 * Generating the same period again returns the invoice already issued —
 * issued invoices are never changed or renumbered.
 */
@Injectable()
export class PlatformInvoiceService {
  constructor(private readonly invoices: PlatformInvoiceRepository) {}

  async generate(
    input: { tenantId: string; from: string; to: string },
    actorId: string | null,
  ): Promise<{ invoice: PlatformInvoiceRow; created: boolean }> {
    if (input.from > input.to) throw validation('The period must start on or before its end');
    const today = new Date().toISOString().slice(0, 10);
    if (input.to >= today) throw validation('Invoice a period that has ended (up to yesterday)');
    return this.invoices.run('platformInvoice.generate', async (scope) => {
      const existing = await this.invoices.findForPeriod(
        scope,
        input.tenantId,
        input.from,
        input.to,
      );
      if (existing) return { invoice: existing, created: false };

      const lines = (
        await this.invoices.usageLines(scope, input.tenantId, input.from, input.to)
      ).map((l) => ({ ...l, description: INVOICE_LINE_LABELS[l.kind] ?? l.kind }));
      if (lines.length === 0) throw validation('Nothing billable for this operator in that period');
      const discounts = await this.invoices.activeDiscounts(
        scope,
        input.tenantId,
        input.from,
        input.to,
      );
      const totals = invoiceTotals(lines, discounts);
      // Credits (a cancelled promotion) reduce an invoice; they cannot turn it negative.
      if (totals.subtotalMinor <= 0)
        throw validation(
          'This period nets to a credit — it is carried by the next settlement, not invoiced',
        );
      const fy = financialYear(input.to);
      const invoiceNumber = platformInvoiceNumber(fy, await this.invoices.nextNumber(scope, fy));
      const id = await this.invoices.insert(scope, {
        tenantId: input.tenantId,
        invoiceNumber,
        periodFrom: input.from,
        periodTo: input.to,
        lines,
        ...totals,
        createdBy: actorId,
      });
      return { invoice: (await this.invoices.find(scope, id))!, created: true };
    });
  }

  list(tenantId: string | null, limit = 100): Promise<PlatformInvoiceRow[]> {
    return this.invoices.run('platformInvoice.list', (scope) =>
      this.invoices.list(scope, tenantId, Math.min(limit, 500)),
    );
  }

  /** One invoice; with `tenantId`, only if it is that operator's. */
  async get(id: string, tenantId?: string): Promise<PlatformInvoiceRow> {
    const inv = await this.invoices.run('platformInvoice.get', (scope) =>
      this.invoices.find(scope, id),
    );
    if (!inv || (tenantId && inv.tenantId !== tenantId)) throw new NotFoundError('Invoice', id);
    return inv;
  }

  createDiscount(
    input: {
      tenantId: string | null;
      kind: 'percent' | 'flat';
      value: number;
      reason: string;
      validFrom: string;
      validTo: string | null;
    },
    actorId: string | null,
  ): Promise<{ id: string }> {
    if (input.kind === 'percent' && input.value > 100)
      throw validation('A percent discount is at most 100');
    if (input.kind === 'flat' && !Number.isInteger(input.value))
      throw validation('A flat discount is a whole number of paise');
    if (input.validTo && input.validTo < input.validFrom)
      throw validation('The discount must end on or after its start');
    return this.invoices.run('platformDiscount.create', async (scope) => ({
      id: await this.invoices.createDiscount(scope, { ...input, createdBy: actorId }),
    }));
  }

  listDiscounts(tenantId: string | null): Promise<PlatformDiscountRow[]> {
    return this.invoices.run('platformDiscount.list', (scope) =>
      this.invoices.listDiscounts(scope, tenantId),
    );
  }

  /** Stops applying to invoices generated from now on; issued invoices keep it. */
  async revokeDiscount(id: string): Promise<void> {
    const ok = await this.invoices.run('platformDiscount.revoke', (scope) =>
      this.invoices.revokeDiscount(scope, id),
    );
    if (!ok) throw new NotFoundError('Discount', id);
  }
}

function validation(message: string): AppError {
  return new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });
}
