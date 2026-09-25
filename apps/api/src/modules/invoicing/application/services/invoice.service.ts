import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { requireTenantId, type BookingId, type Json, type Uuid } from '@kernel';

import { BookingRepository } from '../../../booking';
import { RouteRepository, StopRepository } from '../../../master-data';
import { TenantRepository } from '../../../tenancy';
import { PlatformSettingsRepository } from '../../../platform-settings';
import { NotificationService } from '../../../notification';
import { TripRepository } from '../../../scheduling';
import { computeGstInvoice } from '../../domain/gst-invoice';
import { formatInvoiceNumber } from '../../domain/invoice-number';
import { renderInvoicePdf } from '../../domain/invoice-pdf';
import {
  invoiceSubject,
  invoiceTaxRows,
  invoiceText,
  panFromGstin,
  renderInvoiceEmail,
  type InvoiceDocument,
  type StoredInvoiceLine,
} from '../../domain/invoice-document';
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
    private readonly notifications: NotificationService,
    private readonly trips: TripRepository,
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
   * Emails the GST tax invoice — laid out in the body, with the PDF attached —
   * as its own email, separate from the e-ticket. Sent once per confirmation
   * event (a redelivered event sends nothing) and logged against the booking.
   * Only formats the invoice as issued; never re-derives a tax figure.
   * Returns false when there is no email address, no invoice yet, or it was
   * already sent.
   */
  async emailInvoice(bookingId: BookingId, eventId: Uuid): Promise<boolean> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking?.contactEmail) return false;
    const doc = await this.invoiceDocument(bookingId);
    if (!doc) return false;
    const pdf = await renderInvoicePdf(doc);
    return this.notifications.sendBookingDocument({
      tenantId: requireTenantId(),
      eventId,
      bookingId,
      kind: 'invoice',
      to: booking.contactEmail,
      subject: invoiceSubject(doc),
      html: renderInvoiceEmail(doc),
      text: invoiceText(doc),
      attachments: [
        {
          filename: `Invoice-${doc.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  }

  /** The booking's tax invoice as the customer sees it, or null before it is issued. */
  async invoiceDocument(bookingId: BookingId): Promise<InvoiceDocument | null> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking) return null;
    const invoice = (
      (await this.invoices.findByBooking(bookingId)) as {
        kind: string;
        invoiceNumber: string;
        interState: boolean;
        taxableMinor: number | string;
        taxTotalMinor: number | string;
        roundOffMinor: number | string;
        totalMinor: number | string;
        supplierGstin: string | null;
        lines: StoredInvoiceLine[] | null;
        issuedAt: string | Date;
      }[]
    ).find((r) => r.kind === 'tax');
    if (!invoice) return null;

    const tenantId = requireTenantId();
    const supplier = await this.tenants.getGstDetails();
    const tenant = (await this.tenants.findById(tenantId))?.snapshot();
    const trip = await this.trips.getById(booking.tripId);
    const route = await this.routes.getById(booking.routeId);
    const fromStop = route.path.stops.find((s) => s.sequence === booking.fromSeq);
    const toStop = route.path.stops.find((s) => s.sequence === booking.toSeq);
    const names = await this.stops.loadMany(
      [fromStop?.stopId, toStop?.stopId].filter((x): x is NonNullable<typeof x> => !!x),
    );
    const place = await this.routes.placeOfSupply(booking.routeId);
    const passengers = await this.bookings.loadPassengers(bookingId);
    passengers.sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true }));
    const gstin = invoice.supplierGstin ?? supplier?.gstin ?? null;
    const taxTotalMinor = Number(invoice.taxTotalMinor);

    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: new Date(invoice.issuedAt),
      timeZone: tenant?.timezone ?? 'Asia/Kolkata',
      supplier: {
        name: tenant?.displayName ?? supplier?.legalName ?? 'Operator',
        legalName: supplier?.legalName ?? tenant?.displayName ?? 'Operator',
        gstin,
        pan: panFromGstin(gstin),
        address: supplier?.registeredAddress ?? null,
        logoDataUri: await this.tenants.getLogoUrl(),
      },
      // Billed to the lead passenger: the booking has no separate billing name.
      recipient: {
        name: passengers[0]?.fullName ?? 'Passenger',
        email: booking.contactEmail,
        phone: booking.contactPhone,
      },
      pnr: booking.pnr,
      placeOfSupply: place
        ? `${place.stateName}${place.gstCode ? ` (${place.gstCode})` : ''}`
        : 'India',
      origin: (fromStop && names.get(fromStop.stopId)?.name) ?? 'Boarding point',
      destination: (toStop && names.get(toStop.stopId)?.name) ?? 'Dropping point',
      journeyDate: route.path.instantAt(booking.fromSeq, trip.departsAt, 'depart'),
      interState: invoice.interState,
      rows: invoiceTaxRows(invoice.lines ?? [], invoice.interState, taxTotalMinor),
      taxableMinor: Number(invoice.taxableMinor),
      taxTotalMinor,
      roundOffMinor: Number(invoice.roundOffMinor),
      totalMinor: Number(invoice.totalMinor),
    };
  }
}
