import PDFDocument from 'pdfkit';
import type { KeyFactStatement } from './kfs';

/** The built-in PDF fonts have no ₹ glyph, so amounts are written as "Rs.". */
const rs = (s: string) => s.replace(/₹/g, 'Rs. ');

/**
 * Builds the loan agreement + KFS that the borrower e-signs. The text is a working draft and
 * must be replaced by the version approved by the company's lawyer before launch.
 * Output is deterministic for the same KFS (fixed creation date), so its SHA-256 is stable.
 */
export function buildAgreementPdf(k: KeyFactStatement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Loan agreement ${k.applicationId}`, Author: k.lender, CreationDate: new Date(k.generatedAt) } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const h = (t: string) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(t).font('Helvetica').fontSize(10);
    const row = (a: string, b: string) => doc.text(`${a}: `, { continued: true }).font('Helvetica-Bold').text(rs(b)).font('Helvetica');

    doc.font('Helvetica-Bold').fontSize(16).text('Loan Agreement and Key Fact Statement', { align: 'center' });
    doc.font('Helvetica').fontSize(9).text(`Application ${k.applicationId}  |  Generated ${k.generatedAt}`, { align: 'center' });

    h('1. Parties');
    row('Lender', k.lender);
    row('Borrower', `${k.borrower.name} (PAN ${k.borrower.panMasked}, mobile ${k.borrower.mobile})`);
    row('Disbursal account', `XXXX${k.disbursalAccount.last4}, IFSC ${k.disbursalAccount.ifsc}`);
    if (k.offerName) row('Offer', k.offerName);

    h('2. Key Fact Statement');
    row('Loan amount', k.loan.sanctionedAmount);
    for (const c of k.charges) row(c.item, `${c.amount} (deducted upfront)`);
    row('Amount credited to borrower', k.netDisbursal);
    row('Interest', `${k.interest.rate}, ${k.interest.type}: ${k.interest.amount}`);
    row('Total amount payable', `${k.totalAmountPayable} in one payment`);
    row('Due date', k.loan.dueDateRule);
    row('Total cost of credit', k.totalCostOfCredit);
    row('Annual Percentage Rate (APR)', `${k.aprPercent}%`);
    row('Penal charges', k.penalCharges);

    h('3. Repayment');
    doc.text(rs(k.repayment));
    doc.text(rs(k.prepayment));

    h('4. Cooling-off');
    doc.text(rs(k.coolingOff));

    h('5. Recovery and grievances');
    doc.text(rs(k.recovery));
    doc.text(rs(k.grievanceRedressal));
    doc.text(`Lending service provider: ${k.lendingServiceProvider}`);

    h('6. Other terms');
    for (const n of k.notes) doc.text(`- ${rs(n)}`);
    doc.text('- The borrower confirms that the information given is true and consents to credit bureau reporting of this loan.');

    h('7. Signature');
    doc.text('Signed electronically by the borrower with Aadhaar eSign. The eSign certificate is attached by the eSign provider.');
    doc.end();
  });
}
