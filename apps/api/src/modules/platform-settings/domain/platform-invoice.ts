/**
 * The platform's own GST invoice to an operator (#100), with platform-level
 * discounts applied (#101). Pure arithmetic; the service gathers the lines.
 */
export interface InvoiceLine {
  kind: string;
  description: string;
  count: number;
  baseMinor: number;
  gstMinor: number;
}

export interface PlatformDiscount {
  id: string;
  kind: 'percent' | 'flat';
  /** Percent (0–100] or flat amount in minor units. */
  value: number;
}

export interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  gstMinor: number;
  totalMinor: number;
  discountIds: string[];
}

export const INVOICE_LINE_LABELS: Record<string, string> = {
  booking_commission: 'Booking commission',
  per_bus_fee: 'Bus registration fee',
  notification_sms: 'SMS notifications',
  notification_whatsapp: 'WhatsApp notifications',
  route_promotion: 'Sponsored route listings',
};

/**
 * Percent discounts apply to the subtotal first (each on the full subtotal,
 * summed), then flat ones; the discount never exceeds the subtotal. GST is
 * charged on the discounted value, so it is scaled down in proportion.
 */
export function invoiceTotals(lines: InvoiceLine[], discounts: PlatformDiscount[]): InvoiceTotals {
  const subtotalMinor = lines.reduce((s, l) => s + l.baseMinor, 0);
  const lineGst = lines.reduce((s, l) => s + l.gstMinor, 0);
  if (subtotalMinor <= 0)
    return {
      subtotalMinor,
      discountMinor: 0,
      gstMinor: lineGst,
      totalMinor: subtotalMinor + lineGst,
      discountIds: [],
    };
  let discount = 0;
  const used: string[] = [];
  for (const d of discounts.filter((x) => x.kind === 'percent')) {
    discount += Math.round((subtotalMinor * d.value) / 100);
    used.push(d.id);
  }
  for (const d of discounts.filter((x) => x.kind === 'flat')) {
    discount += Math.round(d.value);
    used.push(d.id);
  }
  const discountMinor = Math.min(discount, subtotalMinor);
  const taxable = subtotalMinor - discountMinor;
  const gstMinor = Math.round((lineGst * taxable) / subtotalMinor);
  return {
    subtotalMinor,
    discountMinor,
    gstMinor,
    totalMinor: taxable + gstMinor,
    discountIds: used,
  };
}

/** Indian financial year of a date, e.g. 2026-09-25 → '2026-27'. */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function platformInvoiceNumber(fy: string, n: number): string {
  return `TKT/${fy}/${String(n).padStart(6, '0')}`;
}
