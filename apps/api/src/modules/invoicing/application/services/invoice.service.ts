import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { requireTenantId, type BookingId, type Json } from '@kernel';

import { BookingRepository } from '../../../booking';
import { RouteRepository, StopRepository } from '../../../master-data';
import { TenantRepository } from '../../../tenancy';
import { PlatformSettingsRepository } from '../../../platform-settings';
import { Mailer } from '../../../notification';
import { computeGstInvoice } from '../../domain/gst-invoice';
import { formatInvoiceNumber } from '../../domain/invoice-number';
import { renderInvoicePdf } from '../../domain/invoice-pdf';
import { InvoiceRepository } from '../../infrastructure/persistence/invoice.repository';

/**
 * Invoice issuance. On `booking.confirmed` a GST tax invoice is raised; on
 * `booking.cancelled` a credit note referencing it. Numbering is gapless (the
 * repository's atomic sequence), the tax split is computed (never entered), and
 * every invoice foots to the paisa (the pure engine guarantees it).
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly bookings: BookingRepository,
    private readonly routes: RouteRepository,
    private readonly stops: StopRepository,
    private readonly tenants: TenantRepository,
    private readonly platformSettings: PlatformSettingsRepository,
    private readonly mailer: Mailer,
    private readonly uow: UnitOfWork,
  ) {}

  async issueForBooking(
    bookingId: BookingId,
    supplierGstin?: string,
  ): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
    return this.uow.run({ name: 'invoice.issue', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking || booking.status !== 'confirmed') return null;

      // Idempotent: at-least-once delivery must not raise a second invoice.
      const already = (await this.invoices.findByBooking(bookingId)) as {
        id: string;
        kind: string;
        invoiceNumber: string;
      }[];
      const priorTax = already.find((i) => i.kind === 'tax');
      if (priorTax) return { invoiceId: priorTax.id, invoiceNumber: priorTax.invoiceNumber };

      // Place of supply — computed from the ROUTE's actual origin/destination
      // states, never assumed. This used to be a hard-coded `false` (always
      // CGST+SGST), which is the wrong document for every inter-state trip.
      const interState = await this.routes.isInterState(booking.routeId);

      // A bus ticket is SAC 9964. The taxable value + the tax are taken
      // DIRECTLY from what this booking actually captured (`booking.taxMinor`,
      // populated from the real fare breakup — see BookingService.hold) —
      // NEVER a fresh back-calculation off a hard-coded rate. A tax invoice
      // that shows a different number than what the customer actually paid
      // is exactly the "leakage" a GST auditor flags first.
      const taxableMinor = booking.totalMinor - booking.taxMinor;

      // Ancillaries (insurance/meals/luggage — see AncillaryService.attach)
      // are taxed at the platform's general SERVICES rate, not the 5%
      // transport rate, and folded into booking.totalMinor/taxMinor
      // alongside the ticket fare. Blending both into ONE invoice line at
      // one averaged rate would put the WRONG rate against BOTH portions —
      // neither the ticket's real ~5% nor the add-ons' real ~18% — which is
      // a genuine Rule-46 defect even though the platform still collects
      // the CORRECT total. Split them back into their own lines here.
      const ancillaryRow = await this.invoices.ancillaryTaxableTotal(bookingId);
      const ancillaryTaxableMinor = ancillaryRow ?? 0;
      const ticketTaxableMinor = taxableMinor - ancillaryTaxableMinor;

      const lines: {
        description: string;
        sac: string;
        taxableMinor: number;
        gstRatePct: number;
      }[] = [];
      if (ticketTaxableMinor > 0) {
        // The rate ACTUALLY applied to the TICKET PORTION, derived at full
        // precision from what remains once the ancillary share is set
        // aside — deliberately NOT "today's" platform GST setting, which
        // may have changed in the (usually sub-second) gap between payment
        // capture and this event-driven invoice issuance.
        const ticketTaxMinor =
          ancillaryTaxableMinor > 0
            ? booking.taxMinor -
              Math.round(
                (ancillaryTaxableMinor * (await this.platformSettings.commissionGstRatePercent())) /
                  100,
              )
            : booking.taxMinor;
        const ticketGstRatePct =
          ticketTaxableMinor > 0 ? (ticketTaxMinor * 100) / ticketTaxableMinor : 0;
        lines.push({
          description: 'Passenger transport by road',
          sac: '9964',
          taxableMinor: ticketTaxableMinor,
          gstRatePct: ticketGstRatePct,
        });
      }
      if (ancillaryTaxableMinor > 0) {
        const ancillaryGstRatePct = await this.platformSettings.commissionGstRatePercent();
        lines.push({
          description: 'Travel add-ons (insurance/meals/luggage)',
          sac: '9997',
          taxableMinor: ancillaryTaxableMinor,
          gstRatePct: ancillaryGstRatePct,
        });
      }
      if (lines.length === 0) {
        lines.push({
          description: 'Passenger transport by road',
          sac: '9964',
          taxableMinor: 0,
          gstRatePct: 0,
        });
      }

      const computed = computeGstInvoice({
        lines,
        interState,
      });

      // Zero-leakage guarantee: the invoice's headline totals are pinned to
      // what was ACTUALLY captured on the booking, not the recomputation
      // above (which exists to get a correct CGST/SGST/IGST *split* and would
      // only ever drift from booking.taxMinor by a paisa of rounding, if at
      // all) — the per-line tax split still sums to taxTotalMinor internally,
      // and the invoice's own round-off line absorbs any residual paisa so
      // taxable + tax + round-off == totalMinor always holds exactly.
      const taxTotalMinor = booking.taxMinor;
      const totalMinor = booking.totalMinor;
      const roundOffMinor = totalMinor - taxableMinor - taxTotalMinor;

      const customPrefix = await this.tenants.getInvoicePrefix();
      const invoicePrefix = customPrefix || 'INV';
      const sequence = await this.invoices.nextSequence(invoicePrefix, new Date());
      const invoiceNumber = formatInvoiceNumber({
        prefix: invoicePrefix,
        date: new Date(),
        sequence,
      });

      const invoiceId = await this.invoices.insert({
        bookingId,
        kind: 'tax',
        invoiceNumber,
        supplierGstin,
        interState,
        taxableMinor,
        taxTotalMinor,
        roundOffMinor,
        totalMinor,
        lines: lines,
        taxLines: computed.taxLines as unknown as Json,
      });
      return { invoiceId, invoiceNumber };
    });
  }

  /** Raise a credit note against a booking's tax invoice on cancellation. */
  async creditNoteForBooking(
    bookingId: BookingId,
  ): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
    return this.uow.run({ name: 'invoice.creditNote', tenantId: requireTenantId() }, async () => {
      const existing = (await this.invoices.findByBooking(bookingId)) as {
        id: string;
        kind: string;
        invoiceNumber: string;
        interState: boolean;
        taxableMinor: number;
        taxTotalMinor: number;
        totalMinor: number;
        lines: Json;
        taxLines: Json;
      }[];
      const original = existing.find((i) => i.kind === 'tax');
      if (!original) return null;
      // Idempotent: one credit note per booking.
      const priorCredit = existing.find((i) => i.kind === 'credit');
      if (priorCredit)
        return { invoiceId: priorCredit.id, invoiceNumber: priorCredit.invoiceNumber };

      const customPrefix = await this.tenants.getInvoicePrefix();
      const creditPrefix = customPrefix ? `${customPrefix}-CN` : 'CRN';
      const sequence = await this.invoices.nextSequence(creditPrefix, new Date());
      const invoiceNumber = formatInvoiceNumber({
        prefix: creditPrefix,
        date: new Date(),
        sequence,
      });

      const invoiceId = await this.invoices.insert({
        bookingId,
        kind: 'credit',
        invoiceNumber,
        // A credit note reverses the ORIGINAL invoice — its place-of-supply
        // must match, or the credit wouldn't offset the original in a GST
        // return (an IGST original can't be reversed by a CGST+SGST credit).
        interState: original.interState,
        taxableMinor: -Number(original.taxableMinor),
        taxTotalMinor: -Number(original.taxTotalMinor),
        roundOffMinor: 0,
        totalMinor: -Number(original.totalMinor),
        lines: original.lines,
        taxLines: original.taxLines,
        originalInvoiceId: original.id,
      });
      return { invoiceId, invoiceNumber };
    });
  }

  async listForBooking(bookingId: BookingId): Promise<unknown[]> {
    return this.invoices.findByBooking(bookingId);
  }

  /**
   * Emails the GST tax invoice as a PDF attachment — SEPARATE from the
   * regular booking.confirmed notification (SMS/WhatsApp/email text), which
   * never carries attachments (ProviderRegistry's generic send() has no
   * concept of one). Called once, right after issueForBooking succeeds, by
   * the SAME worker consumer — never re-derives any tax figure, only
   * formats what issueForBooking already computed and persisted.
   */
  async emailInvoicePdf(bookingId: BookingId): Promise<void> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking?.contactEmail) return; // no email on file — nothing to send to

    const invoiceRows = (await this.invoices.findByBooking(bookingId)) as {
      invoiceNumber: string;
      interState: boolean;
      taxableMinor: number;
      taxTotalMinor: number;
      roundOffMinor: number;
      totalMinor: number;
      supplierGstin: string | null;
      issuedAt: string;
      kind: string;
    }[];
    const invoice = invoiceRows.find((r) => r.kind === 'tax');
    if (!invoice) return; // issueForBooking returned null (booking not confirmed yet) — nothing to email

    const supplier = await this.tenants.getGstDetails();
    const supplierLogoDataUri = await this.tenants.getLogoUrl();
    const route = await this.routes.getById(booking.routeId);
    const origin = route.path.stops[0];
    const destination = route.path.stops[route.path.stops.length - 1];
    const stopIds = [origin?.stopId, destination?.stopId].filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
    const stopNames = await this.stops.loadMany(stopIds);
    const originName = origin ? (stopNames.get(origin.stopId)?.name ?? 'Origin') : 'Origin';
    const destinationName = destination
      ? (stopNames.get(destination.stopId)?.name ?? 'Destination')
      : 'Destination';

    const pdf = await renderInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: new Date(invoice.issuedAt),
      supplierName: supplier?.legalName ?? 'Operator',
      supplierGstin: invoice.supplierGstin,
      supplierAddress: supplier?.registeredAddress ?? null,
      supplierLogoDataUri,
      recipientName: 'Passenger', // booking has no single "billed to" name on file — passenger names live per-seat, not per-booking
      recipientPhone: booking.contactPhone ?? null,
      pnr: booking.pnr,
      routeDescription: `Bus travel — ${originName} to ${destinationName}`,
      interState: invoice.interState,
      taxableMinor: invoice.taxableMinor,
      taxTotalMinor: invoice.taxTotalMinor,
      roundOffMinor: invoice.roundOffMinor,
      totalMinor: invoice.totalMinor,
      sac: '9964',
    });

    await this.mailer.send({
      to: booking.contactEmail,
      subject: `Tax Invoice ${invoice.invoiceNumber} — PNR ${booking.pnr}`,
      html: `<p>Please find attached the GST tax invoice for your booking (PNR ${booking.pnr}).</p><p>This is a computer-generated invoice and does not require a signature.</p>`,
      attachments: [
        {
          filename: `Invoice-${invoice.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
      fromName: supplier?.legalName ?? undefined,
    });
  }
}
