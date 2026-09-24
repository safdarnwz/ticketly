import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Invoice numbering — GST-compliant sequential series
 * ============================================================================
 *
 * GST law requires invoice numbers to be a **consecutive series, unique within
 * a financial year**, per a documented format. A gap or a duplicate is a
 * compliance problem. The number is therefore allocated from a per-(tenant,
 * series, financial-year) counter that is incremented atomically in the
 * database (the repository uses an UPSERT … RETURNING), and this pure module
 * only formats it.
 *
 * Indian financial year runs April→March, so an invoice on 2026-05-01 is FY
 * 2026-27 and one on 2026-02-01 is FY 2025-26. That derivation is here (and
 * tested) because getting it wrong shifts the whole numbering series.
 */

/** Financial year label for a date, e.g. '2026-27'. FY starts 1 April. */
export function financialYear(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0 = Jan
  const startYear = month >= 3 ? year : year - 1; // Apr (3) onwards → this year
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

/**
 * Format an invoice number from its parts.
 *   prefix / FY / zero-padded sequence   →   "INV/2026-27/000123"
 */
export function formatInvoiceNumber(input: {
  prefix: string;
  date: Date;
  sequence: number;
  pad?: number;
}): string {
  if (input.sequence < 1)
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Invoice sequence must be >= 1');
  const seq = String(input.sequence).padStart(input.pad ?? 6, '0');
  const prefix = (input.prefix || 'INV').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${prefix}/${financialYear(input.date)}/${seq}`;
}

/** The series key a counter is kept under — one sequence per (prefix, FY). */
export function seriesKey(prefix: string, date: Date): string {
  return `${prefix.toUpperCase()}:${financialYear(date)}`;
}
