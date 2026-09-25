import { describe, expect, it } from 'vitest';

import {
  amountInWords,
  invoiceTaxRows,
  numberToIndianWords,
  panFromGstin,
  renderInvoiceEmail,
  type InvoiceDocument,
} from '../domain/invoice-document';

describe('amount in words (Indian system)', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [15, 'Fifteen'],
    [40, 'Forty'],
    [99, 'Ninety Nine'],
    [100, 'One Hundred'],
    [1470, 'One Thousand Four Hundred Seventy'],
    [100000, 'One Lakh'],
    [2505001, 'Twenty Five Lakh Five Thousand One'],
    [123456789, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine'],
  ])('%i → %s', (n, words) => expect(numberToIndianWords(n)).toBe(words));

  it('rupees and paise', () => {
    expect(amountInWords(147050)).toBe(
      'Rupees One Thousand Four Hundred Seventy and Paise Fifty Only',
    );
    expect(amountInWords(100)).toBe('Rupees One Only');
    expect(amountInWords(5)).toBe('Rupees Zero and Paise Five Only');
  });
  it('a credit note (negative) says so', () => {
    expect(amountInWords(-2500)).toBe('Minus Rupees Twenty Five Only');
  });
  it('refuses a nonsense number', () => {
    expect(() => numberToIndianWords(Number.NaN)).toThrow();
  });
});

describe('PAN from GSTIN', () => {
  it('characters 3–12 of a well-formed GSTIN', () => {
    expect(panFromGstin('07AABCT1332L1ZU')).toBe('AABCT1332L');
    expect(panFromGstin(' 07aabct1332l1zu ')).toBe('AABCT1332L');
  });
  it('nothing for a missing or malformed GSTIN', () => {
    expect(panFromGstin(null)).toBeNull();
    expect(panFromGstin('')).toBeNull();
    expect(panFromGstin('07AABCT1332L')).toBeNull();
    expect(panFromGstin('XXAABCT1332L1ZU')).toBeNull();
  });
});

describe('invoice tax rows', () => {
  const ticket = {
    description: 'Passenger transport by road',
    sac: '9964',
    taxableMinor: 140000,
    gstRatePct: 5,
  };
  const addon = { description: 'Travel add-ons', sac: '9997', taxableMinor: 10000, gstRatePct: 18 };

  it('intra-state: CGST + SGST per line, foots to the invoice tax', () => {
    const rows = invoiceTaxRows([ticket, addon], false, 7000 + 1800);
    expect(rows[0]).toMatchObject({ cgstMinor: 3500, sgstMinor: 3500, igstMinor: 0, ratePct: 5 });
    expect(rows[1]).toMatchObject({ cgstMinor: 900, sgstMinor: 900 });
    expect(rows.reduce((s, r) => s + r.cgstMinor + r.sgstMinor + r.igstMinor, 0)).toBe(8800);
  });
  it('inter-state: IGST only', () => {
    const rows = invoiceTaxRows([ticket], true, 7000);
    expect(rows[0]).toMatchObject({ cgstMinor: 0, sgstMinor: 0, igstMinor: 7000 });
  });
  it('a paisa of difference from the booking’s own tax lands on the first line', () => {
    const intra = invoiceTaxRows([ticket], false, 7001);
    expect(intra[0].cgstMinor + intra[0].sgstMinor).toBe(7001);
    const inter = invoiceTaxRows([ticket], true, 6999);
    expect(inter[0].igstMinor).toBe(6999);
  });
  it('shows a derived rate rounded to two decimals', () => {
    expect(invoiceTaxRows([{ ...ticket, gstRatePct: 4.999999 }], true, 7000)[0].ratePct).toBe(5);
  });
  it('no lines, no rows', () => {
    expect(invoiceTaxRows([], false, 0)).toEqual([]);
  });
});

describe('invoice email', () => {
  const doc: InvoiceDocument = {
    invoiceNumber: 'INV-2026-000123',
    invoiceDate: new Date('2026-09-25T06:30:00Z'),
    timeZone: 'Asia/Kolkata',
    supplier: {
      name: 'Orange Travels',
      legalName: 'Orange Travels Pvt Ltd',
      gstin: '07AABCT1332L1ZU',
      pan: 'AABCT1332L',
      address: 'Kashmere Gate, Delhi',
      logoDataUri: null,
    },
    recipient: { name: 'Asha <b>Verma</b>', email: 'asha@example.in', phone: '9876543210' },
    pnr: 'P8SJAR',
    placeOfSupply: 'Delhi (07)',
    origin: 'Kashmere Gate ISBT',
    destination: 'Sindhi Camp Bus Stand',
    journeyDate: new Date('2026-09-28T16:00:00Z'),
    interState: true,
    rows: invoiceTaxRows(
      [
        {
          description: 'Passenger transport by road',
          sac: '9964',
          taxableMinor: 280000,
          gstRatePct: 5,
        },
      ],
      true,
      14000,
    ),
    taxableMinor: 280000,
    taxTotalMinor: 14000,
    roundOffMinor: 0,
    totalMinor: 294000,
  };
  const html = renderInvoiceEmail(doc);

  it('carries every field of a GST invoice', () => {
    for (const s of [
      'INV-2026-000123',
      'P8SJAR',
      'Delhi (07)',
      'Orange Travels Pvt Ltd',
      'AABCT1332L',
      '07AABCT1332L1ZU',
      'Kashmere Gate ISBT',
      'Sindhi Camp Bus Stand',
      'SAC 9964',
      'IGST',
      '₹2,940.00',
      'Rupees Two Thousand Nine Hundred Forty Only',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('CGST');
  });
  it('escapes what customers typed', () => {
    expect(html).toContain('Asha &lt;b&gt;Verma&lt;/b&gt;');
    expect(html).not.toContain('<b>Verma</b>');
  });
});
