import PDFDocument from 'pdfkit';

import { BRAND_PALETTE as P } from '@kernel';

import { amountInWords, formatInvoiceDate, type InvoiceDocument } from './invoice-document';

// The built-in PDF fonts have no rupee glyph.
const money = (minor: number) =>
  `Rs. ${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The GST tax invoice (CGST Rule 46) as a PDF — the same document the
 * invoice email shows, formatted from the invoice as issued; nothing here
 * recalculates a total.
 */
export function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = 50;
    const width = 495;

    // A broken logo is cosmetic; it must never stop the invoice.
    if (doc.supplier.logoDataUri) {
      try {
        const base64 = doc.supplier.logoDataUri.split(',')[1];
        if (base64) pdf.image(Buffer.from(base64, 'base64'), 455, 40, { fit: [90, 50] });
      } catch {
        /* unsupported logo */
      }
    }

    pdf.fontSize(18).fillColor(P.primary).text('TAX INVOICE', left, 50);
    pdf.fontSize(9).fillColor(P.textMuted).text('Issued under Rule 46, CGST Rules, 2017');
    pdf.moveDown(1);

    pdf.fontSize(12).fillColor(P.text).text(doc.supplier.legalName);
    pdf.fontSize(9).fillColor(P.text);
    if (doc.supplier.name !== doc.supplier.legalName) pdf.text(`Trading as ${doc.supplier.name}`);
    if (doc.supplier.gstin) pdf.text(`GSTIN: ${doc.supplier.gstin}`);
    if (doc.supplier.pan) pdf.text(`PAN: ${doc.supplier.pan}`);
    if (doc.supplier.address) pdf.text(doc.supplier.address, { width: 300 });
    pdf.moveDown(1);

    // Two columns of details.
    const top = pdf.y;
    const pair = (k: string, v: string, x: number, y: number) => {
      pdf.fontSize(8).fillColor(P.textMuted).text(k, x, y, { width: 230 });
      pdf
        .fontSize(10)
        .fillColor(P.text)
        .text(v, x, y + 10, { width: 230 });
    };
    pair('Invoice number', doc.invoiceNumber, left, top);
    pair('Invoice date', formatInvoiceDate(doc.invoiceDate, doc.timeZone), left, top + 28);
    pair('PNR', doc.pnr, left, top + 56);
    pair('Place of supply', doc.placeOfSupply, left, top + 84);
    pair('Customer name', doc.recipient.name, 300, top);
    pair(
      'Customer contact',
      [doc.recipient.email, doc.recipient.phone].filter(Boolean).join(' · ') || '—',
      300,
      top + 28,
    );
    pair('Journey', `${doc.origin} to ${doc.destination}`, 300, top + 56);
    pair(
      'Date of journey',
      doc.journeyDate ? formatInvoiceDate(doc.journeyDate, doc.timeZone) : '—',
      300,
      top + 84,
    );

    // Line table.
    let y = top + 125;
    const cols = doc.interState
      ? [
          { t: 'Description', x: left + 5, w: 200, a: 'left' as const },
          { t: 'SAC', x: 255, w: 40, a: 'left' as const },
          { t: 'Rate', x: 295, w: 40, a: 'right' as const },
          { t: 'Taxable value', x: 340, w: 95, a: 'right' as const },
          { t: 'IGST', x: 440, w: 100, a: 'right' as const },
        ]
      : [
          { t: 'Description', x: left + 5, w: 170, a: 'left' as const },
          { t: 'SAC', x: 225, w: 35, a: 'left' as const },
          { t: 'Rate', x: 260, w: 35, a: 'right' as const },
          { t: 'Taxable value', x: 300, w: 85, a: 'right' as const },
          { t: 'CGST', x: 390, w: 70, a: 'right' as const },
          { t: 'SGST', x: 465, w: 75, a: 'right' as const },
        ];
    pdf.rect(left, y, width, 20).fill(P.primary);
    pdf.fontSize(9).fillColor('#fff');
    for (const c of cols) pdf.text(c.t, c.x, y + 6, { width: c.w, align: c.a });
    y += 26;
    pdf.fillColor(P.text);
    for (const r of doc.rows) {
      const cells = [
        r.description,
        r.sac,
        `${r.ratePct}%`,
        money(r.taxableMinor),
        ...(doc.interState ? [money(r.igstMinor)] : [money(r.cgstMinor), money(r.sgstMinor)]),
      ];
      cols.forEach((c, i) => pdf.text(cells[i], c.x, y, { width: c.w, align: c.a }));
      y += 22;
      pdf
        .moveTo(left, y - 5)
        .lineTo(left + width, y - 5)
        .strokeColor(P.border)
        .stroke();
    }

    // Totals.
    y += 6;
    const total = (k: string, v: string, bold = false) => {
      pdf.fontSize(bold ? 11 : 9).fillColor(P.text);
      pdf.text(k, 300, y, { width: 140, align: 'right' });
      pdf.text(v, 440, y, { width: 100, align: 'right' });
      y += bold ? 18 : 14;
    };
    total('Taxable value', money(doc.taxableMinor));
    total(doc.interState ? 'IGST' : 'CGST + SGST', money(doc.taxTotalMinor));
    if (doc.roundOffMinor !== 0) total('Round off', money(doc.roundOffMinor));
    total('Total (incl. GST)', money(doc.totalMinor), true);

    pdf
      .fontSize(9)
      .fillColor(P.text)
      .text(`Amount in words: ${amountInWords(doc.totalMinor)}`, left, y + 8, { width });

    pdf
      .fontSize(8)
      .fillColor(P.textMuted)
      .text('This is a computer-generated invoice and does not require a signature.', left, 770, {
        width,
        align: 'center',
      });

    pdf.end();
  });
}
