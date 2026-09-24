import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { newId, requireTenantId, type BookingId, type Json } from '@kernel';

import { seriesKey } from '../../domain/invoice-number';

/**
 * Invoice persistence, incl. the atomic sequence allocation that guarantees a
 * gapless GST numbering series. `nextSequence` uses an UPSERT … RETURNING which
 * increments and returns the counter in one statement, so two concurrent
 * invoice issuances can never get the same number or leave a gap.
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Atomically allocate the next sequence for a (prefix, financial-year). */
  async nextSequence(prefix: string, date: Date): Promise<number> {
    const key = seriesKey(prefix, date);
    const scope = currentTransaction();
    const runner = scope
      ? (sql: string, p: unknown[]) =>
          scope.client.query<{ last_sequence: number }>(sql, p).then((r) => r.rows[0] ?? null)
      : (sql: string, p: unknown[]) =>
          this.db.queryOne<{ last_sequence: number }>(sql, p, {
            name: 'invoice.nextSeq',
            primary: true,
          });
    const row = await runner(
      `INSERT INTO invoice_series (tenant_id, series_key, last_sequence) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, series_key) DO UPDATE SET last_sequence = invoice_series.last_sequence + 1, updated_at = now()
       RETURNING last_sequence`,
      [requireTenantId(), key],
    );
    return row?.last_sequence ?? 1;
  }

  async insert(input: {
    bookingId: BookingId | null;
    kind: 'tax' | 'credit';
    invoiceNumber: string;
    supplierGstin?: string;
    recipientGstin?: string;
    placeOfSupply?: string;
    interState: boolean;
    taxableMinor: number;
    taxTotalMinor: number;
    roundOffMinor: number;
    totalMinor: number;
    lines: Json;
    taxLines: Json;
    originalInvoiceId?: string;
  }): Promise<string> {
    const scope = currentTransaction();
    const id = newId();
    const sql = `INSERT INTO invoices
        (id, tenant_id, booking_id, kind, invoice_number, supplier_gstin, recipient_gstin, place_of_supply,
         inter_state, taxable_minor, tax_total_minor, round_off_minor, total_minor, lines, tax_lines, original_invoice_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`;
    const params = [
      id,
      requireTenantId(),
      input.bookingId,
      input.kind,
      input.invoiceNumber,
      input.supplierGstin ?? null,
      input.recipientGstin ?? null,
      input.placeOfSupply ?? null,
      input.interState,
      input.taxableMinor,
      input.taxTotalMinor,
      input.roundOffMinor,
      input.totalMinor,
      JSON.stringify(input.lines),
      JSON.stringify(input.taxLines),
      input.originalInvoiceId ?? null,
    ];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'invoice.insert', primary: true });
    return id;
  }

  async findByBooking(bookingId: BookingId): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, kind, invoice_number AS "invoiceNumber", inter_state AS "interState", taxable_minor AS "taxableMinor",
              tax_total_minor AS "taxTotalMinor", round_off_minor AS "roundOffMinor", total_minor AS "totalMinor",
              supplier_gstin AS "supplierGstin", lines, tax_lines AS "taxLines", issued_at AS "issuedAt"
         FROM invoices WHERE tenant_id = $1 AND booking_id = $2 ORDER BY issued_at`,
      [requireTenantId(), bookingId],
      { name: 'invoice.findByBooking' },
    );
  }

  /** Sum of this booking's ancillary line-items' TAXABLE (pre-GST) value — booking_ancillaries.total_minor is stored tax-exclusive (see AncillaryService.attach). Used to split the invoice's single blended line back into a correctly-rated ticket line + ancillary line. */
  async ancillaryTaxableTotal(bookingId: BookingId): Promise<number> {
    const row = await this.db.queryOne<{ total: string | null }>(
      `SELECT sum(total_minor)::bigint AS total FROM booking_ancillaries WHERE tenant_id = $1 AND booking_id = $2`,
      [requireTenantId(), bookingId],
      { name: 'invoice.ancillaryTaxableTotal' },
    );
    return row?.total ? Number(row.total) : 0;
  }
}
