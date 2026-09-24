import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  GST tax invoice computation (India)
 * ============================================================================
 *
 * A tax invoice is a legal document, so its arithmetic must be exact and its
 * structure must satisfy the GST rules. This pure engine produces the invoice
 * lines and the CGST/SGST/IGST split from a booking's charges. Money is integer
 * minor units so the invoice always foots to the paisa.
 *
 * RULES ENCODED:
 *  - **Place of supply** decides the tax type: intra-state → CGST + SGST (each
 *    half the rate); inter-state → IGST (the full rate). This is the single most
 *    common GST-invoice error, so it is computed, never entered.
 *  - **Taxable value** is the pre-tax amount (fare + ancillaries − discount).
 *    GST is charged on that, never on GST.
 *  - **HSN/SAC**: passenger transport by road is SAC 9964. Each line carries its
 *    SAC so the invoice is filing-ready.
 *  - **Rounding**: the invoice total is rounded to the nearest rupee and the
 *    rounding adjustment is shown as its own line (as GST invoices require), so
 *    line items + tax + round-off == the amount charged, exactly.
 */

export interface InvoiceLineInput {
  description: string;
  sac: string; // Service Accounting Code, e.g. '9964'
  /** Pre-tax taxable value for this line, minor units. */
  taxableMinor: number;
  gstRatePct: number;
}

export interface InvoiceTaxLine {
  name: 'CGST' | 'SGST' | 'IGST';
  ratePct: number;
  amountMinor: number;
}

export interface ComputedInvoice {
  taxableMinor: number;
  taxLines: InvoiceTaxLine[];
  taxTotalMinor: number;
  roundOffMinor: number;
  totalMinor: number;
  interState: boolean;
}

export function computeGstInvoice(input: {
  lines: InvoiceLineInput[];
  interState: boolean;
  currency?: CurrencyCode;
}): ComputedInvoice {
  const currency = input.currency ?? 'INR';
  if (input.lines.length === 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'An invoice needs at least one line');
  }

  let taxableMinor = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  for (const line of input.lines) {
    if (line.taxableMinor < 0) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Taxable value cannot be negative');
    taxableMinor += line.taxableMinor;
    const lineTax = Money.of(line.taxableMinor, currency).percent(line.gstRatePct).minor;
    if (input.interState) {
      igst += lineTax;
    } else {
      // Split evenly with no lost paisa — CGST gets the remainder.
      const half = Money.of(lineTax, currency).allocate(2);
      cgst += half[0].minor;
      sgst += half[1].minor;
    }
  }

  const taxLines: InvoiceTaxLine[] = input.interState
    ? [{ name: 'IGST', ratePct: avgRate(input.lines), amountMinor: igst }]
    : [
        { name: 'CGST', ratePct: avgRate(input.lines) / 2, amountMinor: cgst },
        { name: 'SGST', ratePct: avgRate(input.lines) / 2, amountMinor: sgst },
      ];

  const taxTotalMinor = taxLines.reduce((s, t) => s + t.amountMinor, 0);
  const preRound = taxableMinor + taxTotalMinor;
  // Round the grand total to the nearest rupee (100 paise).
  const rounded = Math.round(preRound / 100) * 100;
  const roundOffMinor = rounded - preRound;

  return {
    taxableMinor,
    taxLines,
    taxTotalMinor,
    roundOffMinor,
    totalMinor: rounded,
    interState: input.interState,
  };
}

/** Weighted-average GST rate for display (invoices with mixed rates are rare). */
function avgRate(lines: InvoiceLineInput[]): number {
  const total = lines.reduce((s, l) => s + l.taxableMinor, 0);
  if (total === 0) return lines[0]?.gstRatePct ?? 0;
  const weighted = lines.reduce((s, l) => s + l.gstRatePct * l.taxableMinor, 0);
  return Math.round((weighted / total) * 100) / 100;
}
