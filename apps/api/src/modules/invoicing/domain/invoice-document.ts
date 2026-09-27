import { BRAND_PALETTE } from '@kernel';

import { computeGstInvoice } from './gst-invoice';

/**
 * The GST tax invoice as the customer sees it — in the email body and in the
 * attached PDF. Pure: it formats the invoice row as issued (never re-derives
 * the totals); the only arithmetic is splitting the stored tax total across
 * the lines and CGST/SGST/IGST so the columns add up to it to the paisa.
 */

export interface StoredInvoiceLine {
  description: string;
  sac: string;
  taxableMinor: number;
  gstRatePct: number;
}

export interface InvoiceTaxRow {
  description: string;
  sac: string;
  taxableMinor: number;
  ratePct: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

export interface InvoiceDocument {
  invoiceNumber: string;
  invoiceDate: Date;
  timeZone: string;
  supplier: {
    name: string;
    legalName: string;
    gstin: string | null;
    pan: string | null;
    address: string | null;
    logoDataUri: string | null;
  };
  recipient: { name: string; email: string | null; phone: string | null };
  pnr: string;
  placeOfSupply: string;
  origin: string;
  destination: string;
  journeyDate: Date | null;
  interState: boolean;
  rows: InvoiceTaxRow[];
  taxableMinor: number;
  taxTotalMinor: number;
  roundOffMinor: number;
  totalMinor: number;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A GSTIN carries the holder's PAN in characters 3–12. */
export function panFromGstin(gstin: string | null | undefined): string | null {
  const g = gstin?.trim().toUpperCase();
  return g && GSTIN.test(g) ? g.slice(2, 12) : null;
}

/**
 * Per line: taxable value, rate and the CGST/SGST (intra-state) or IGST
 * (inter-state) amounts. Any paisa between the per-line tax and the tax the
 * booking actually carried goes on the first line, so the table foots to the
 * invoice's own tax total exactly.
 */
export function invoiceTaxRows(
  lines: readonly StoredInvoiceLine[],
  interState: boolean,
  taxTotalMinor: number,
): InvoiceTaxRow[] {
  const rows = lines.map((l) => {
    const c = computeGstInvoice({ lines: [l], interState });
    const amount = (n: 'CGST' | 'SGST' | 'IGST') =>
      c.taxLines.find((t) => t.name === n)?.amountMinor ?? 0;
    return {
      description: l.description,
      sac: l.sac,
      taxableMinor: l.taxableMinor,
      ratePct: Math.round(l.gstRatePct * 100) / 100,
      cgstMinor: amount('CGST'),
      sgstMinor: amount('SGST'),
      igstMinor: amount('IGST'),
    };
  });
  if (rows.length === 0) return rows;
  const sum = rows.reduce((s, r) => s + r.cgstMinor + r.sgstMinor + r.igstMinor, 0);
  const diff = taxTotalMinor - sum;
  if (diff !== 0) {
    const first = rows[0];
    if (interState) first.igstMinor += diff;
    else {
      // Keep CGST and SGST as even as possible.
      const half = Math.trunc(diff / 2);
      first.cgstMinor += diff - half;
      first.sgstMinor += half;
    }
  }
  return rows;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ');
}

/** Whole number in the Indian system (thousand, lakh, crore). */
export function numberToIndianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error('Only non-negative amounts');
  n = Math.floor(n);
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** "Rupees One Thousand Two Hundred and Paise Fifty Only". */
export function amountInWords(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const words = `Rupees ${numberToIndianWords(rupees)}${paise ? ` and Paise ${belowHundred(paise)}` : ''} Only`;
  return negative ? `Minus ${words}` : words;
}

const rs = (minor: number) =>
  `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function formatInvoiceDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function invoiceSubject(doc: InvoiceDocument): string {
  return `GST tax invoice ${doc.invoiceNumber} — PNR ${doc.pnr}`;
}

export function invoiceText(doc: InvoiceDocument): string {
  const tax = doc.rows.reduce(
    (a, r) => ({ c: a.c + r.cgstMinor, s: a.s + r.sgstMinor, i: a.i + r.igstMinor }),
    { c: 0, s: 0, i: 0 },
  );
  return [
    `Tax invoice ${doc.invoiceNumber} dated ${formatInvoiceDate(doc.invoiceDate, doc.timeZone)}`,
    `Customer: ${doc.recipient.name}`,
    `PNR: ${doc.pnr}`,
    `Place of supply: ${doc.placeOfSupply}`,
    `Supplier: ${doc.supplier.legalName}${doc.supplier.gstin ? `, GSTIN ${doc.supplier.gstin}` : ''}${doc.supplier.pan ? `, PAN ${doc.supplier.pan}` : ''}`,
    `Journey: ${doc.origin} to ${doc.destination}`,
    `Taxable value: ${rs(doc.taxableMinor)}`,
    doc.interState ? `IGST: ${rs(tax.i)}` : `CGST: ${rs(tax.c)}, SGST: ${rs(tax.s)}`,
    ...(doc.roundOffMinor ? [`Round off: ${rs(doc.roundOffMinor)}`] : []),
    `Total: ${rs(doc.totalMinor)} (${amountInWords(doc.totalMinor)})`,
    '',
    'The invoice is attached as a PDF. This is a computer-generated invoice and needs no signature.',
  ].join('\n');
}

/** The invoice laid out in the email body (the PDF is attached too). */
export function renderInvoiceEmail(doc: InvoiceDocument): string {
  const P = BRAND_PALETTE;
  const muted = `color:${P.textMuted};font-size:12px`;
  const cell = `padding:6px 8px;border-bottom:1px solid ${P.border};font-size:13px`;
  const num = `${cell};text-align:right;white-space:nowrap`;
  const kv = (k: string, v: string | null) =>
    v
      ? `<tr><td style="${muted};padding:3px 0;width:42%">${esc(k)}</td><td style="font-size:13px;padding:3px 0">${esc(v)}</td></tr>`
      : '';
  const taxHead = doc.interState
    ? `<th style="${num}">IGST</th>`
    : `<th style="${num}">CGST</th><th style="${num}">SGST</th>`;
  const rows = doc.rows
    .map(
      (r) => `<tr>
      <td style="${cell}">${esc(r.description)}<div style="${muted}">SAC ${esc(r.sac)} · GST ${r.ratePct}%</div></td>
      <td style="${num}">${rs(r.taxableMinor)}</td>
      ${doc.interState ? `<td style="${num}">${rs(r.igstMinor)}</td>` : `<td style="${num}">${rs(r.cgstMinor)}</td><td style="${num}">${rs(r.sgstMinor)}</td>`}
    </tr>`,
    )
    .join('');
  const span = doc.interState ? 2 : 3;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(invoiceSubject(doc))}</title></head>
<body style="margin:0;padding:16px;background:${P.bg};font-family:Arial,Helvetica,sans-serif;color:${P.text}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:${P.surface};border:1px solid ${P.border};border-top:5px solid ${P.primary};border-radius:16px">
<tr><td style="padding:18px 20px;border-bottom:1px solid ${P.border}">
  <div style="font-size:12px;letter-spacing:1px;color:${P.accent};font-weight:700">TAX INVOICE</div>
  <div style="font-size:18px;font-weight:700;margin-top:4px">${esc(doc.supplier.name)}</div>
  <div style="${muted}">Invoice ${esc(doc.invoiceNumber)} · ${esc(formatInvoiceDate(doc.invoiceDate, doc.timeZone))}</div>
</td></tr>
<tr><td style="padding:14px 20px;border-bottom:1px solid ${P.border}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    ${kv('Customer name', doc.recipient.name)}
    ${kv('Customer email', doc.recipient.email)}
    ${kv('Invoice number', doc.invoiceNumber)}
    ${kv('PNR', doc.pnr)}
    ${kv('Place of supply', doc.placeOfSupply)}
    ${kv('Operator name', doc.supplier.legalName)}
    ${kv('Operator PAN', doc.supplier.pan)}
    ${kv('Operator GSTIN', doc.supplier.gstin)}
    ${kv('Operator address', doc.supplier.address)}
    ${kv('Origin', doc.origin)}
    ${kv('Destination', doc.destination)}
    ${kv('Date of journey', doc.journeyDate ? formatInvoiceDate(doc.journeyDate, doc.timeZone) : null)}
  </table>
</td></tr>
<tr><td style="padding:8px 12px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr><th style="${cell};text-align:left">Description</th><th style="${num}">Taxable value</th>${taxHead}</tr>
    ${rows}
    ${doc.roundOffMinor ? `<tr><td style="${cell}" colspan="${span}">Round off</td><td style="${num}">${rs(doc.roundOffMinor)}</td></tr>` : ''}
    <tr><td style="${cell};font-weight:700" colspan="${span}">Total (incl. GST)</td><td style="${num};font-weight:700;color:${P.info}">${rs(doc.totalMinor)}</td></tr>
  </table>
  <div style="font-size:13px;margin:10px 8px 0"><span style="${muted}">Amount in words:</span> ${esc(amountInWords(doc.totalMinor))}</div>
</td></tr>
<tr><td style="padding:12px 20px;border-top:1px solid ${P.border};${muted}">The PDF copy is attached. This is a computer-generated invoice and needs no signature. Your e-ticket was sent in a separate email.</td></tr>
</table></body></html>`;
}
