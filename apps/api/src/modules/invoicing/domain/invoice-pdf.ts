import PDFDocument from 'pdfkit';

export interface InvoicePdfInput {
  invoiceNumber: string;
  invoiceDate: Date;
  supplierName: string;
  supplierGstin: string | null;
  supplierAddress: string | null;
  supplierLogoDataUri: string | null;
  recipientName: string;
  recipientPhone: string | null;
  pnr: string;
  routeDescription: string;
  interState: boolean;
  taxableMinor: number;
  taxTotalMinor: number;
  roundOffMinor: number;
  totalMinor: number;
  sac: string;
}

const money = (minor: number) => `Rs. ${(minor / 100).toFixed(2)}`;

/**
 * Renders a CGST Rule 46-compliant tax invoice as a PDF buffer — the exact
 * numbers ALREADY computed and stored on the invoice row (gst-invoice.ts's
 * output), never recalculated here. A PDF renderer that re-derives the tax
 * split from scratch is exactly the kind of place a rounding rule could
 * quietly drift from the number actually posted to the ledger — this
 * function only ever formats what invoice.repository.ts already persisted.
 */
export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('TAX INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .fillColor('#555')
      .text('Issued under Rule 46, CGST Rules, 2017', { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('#000');

    // Logo, top-right corner — decoded from the data: URI stored on the
    // tenant (TenantRepository.getLogoUrl); pdfkit's image() needs an
    // actual Buffer, never the data: URI string itself. Never lets a
    // malformed/corrupt logo break invoice generation — a missing logo is
    // cosmetic, a missing invoice is a compliance problem.
    if (input.supplierLogoDataUri) {
      try {
        const base64 = input.supplierLogoDataUri.split(',')[1];
        if (base64) doc.image(Buffer.from(base64, 'base64'), 455, 40, { fit: [90, 50] });
      } catch {
        /* corrupt/unsupported logo data — proceed without it */
      }
    }

    // Supplier / invoice-meta block
    doc.fontSize(12).text(input.supplierName, { continued: false });
    if (input.supplierGstin)
      doc.fontSize(10).fillColor('#333').text(`GSTIN: ${input.supplierGstin}`);
    if (input.supplierAddress) doc.fontSize(10).fillColor('#333').text(input.supplierAddress);
    doc.moveDown(1);
    doc.fillColor('#000');

    const metaTop = doc.y;
    doc.fontSize(10).text(`Invoice No: ${input.invoiceNumber}`, 50, metaTop);
    doc.text(`Invoice Date: ${input.invoiceDate.toLocaleDateString('en-IN')}`, 50, metaTop + 15);
    doc.text(`PNR: ${input.pnr}`, 300, metaTop, { align: 'right', width: 245 });
    doc.text(
      `Place of supply: ${input.interState ? 'Inter-state' : 'Intra-state'}`,
      300,
      metaTop + 15,
      { align: 'right', width: 245 },
    );
    doc.moveDown(3);

    // Recipient block
    doc.fontSize(10).fillColor('#555').text('Billed to:');
    doc.fillColor('#000').fontSize(11).text(input.recipientName);
    if (input.recipientPhone) doc.fontSize(10).fillColor('#333').text(input.recipientPhone);
    doc.moveDown(1.5);
    doc.fillColor('#000');

    // Line-item table (single line: the transport service itself)
    const tableTop = doc.y;
    doc.fontSize(10).fillColor('#fff');
    doc.rect(50, tableTop, 495, 20).fill('#0b6e4f');
    doc.fillColor('#fff').text('Description', 55, tableTop + 5, { width: 220 });
    doc.text('SAC', 280, tableTop + 5, { width: 60 });
    doc.text('Taxable Value', 345, tableTop + 5, { width: 90, align: 'right' });
    doc.text('Tax', 445, tableTop + 5, { width: 90, align: 'right' });
    doc.fillColor('#000');

    const rowY = tableTop + 25;
    doc.fontSize(10).text(input.routeDescription, 55, rowY, { width: 220 });
    doc.text(input.sac, 280, rowY, { width: 60 });
    doc.text(money(input.taxableMinor), 345, rowY, { width: 90, align: 'right' });
    doc.text(money(input.taxTotalMinor), 445, rowY, { width: 90, align: 'right' });
    doc
      .moveTo(50, rowY + 20)
      .lineTo(545, rowY + 20)
      .strokeColor('#ddd')
      .stroke();

    // GST split — CGST+SGST for intra-state, IGST for inter-state, matching
    // gst-invoice.ts's own split logic exactly (never re-derived here).
    let y = rowY + 35;
    doc.fontSize(9).fillColor('#555');
    if (input.interState) {
      doc.text(`IGST: ${money(input.taxTotalMinor)}`, 345, y, { width: 190, align: 'right' });
      y += 15;
    } else {
      const half = Math.round(input.taxTotalMinor / 2);
      doc.text(`CGST: ${money(half)}`, 345, y, { width: 190, align: 'right' });
      y += 15;
      doc.text(`SGST: ${money(input.taxTotalMinor - half)}`, 345, y, {
        width: 190,
        align: 'right',
      });
      y += 15;
    }
    if (input.roundOffMinor !== 0) {
      doc.text(`Round off: ${money(input.roundOffMinor)}`, 345, y, { width: 190, align: 'right' });
      y += 15;
    }

    doc
      .fillColor('#000')
      .fontSize(12)
      .text(`Total: ${money(input.totalMinor)}`, 345, y + 5, { width: 190, align: 'right' });

    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a computer-generated invoice and does not require a signature.', 50, 750, {
        width: 495,
        align: 'center',
      });

    doc.end();
  });
}
