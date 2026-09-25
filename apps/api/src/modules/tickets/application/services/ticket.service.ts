import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';

import { AppConfig } from '@config';
import { Permission } from '@contracts';
import {
  AppError,
  ErrorCode,
  getContext,
  getUserId,
  hasPermission,
  requireTenantId,
  runAsTenant,
  type BookingId,
  type TenantId,
  type Uuid,
} from '@kernel';
import { hmacSha256 } from '@security';

import { BookingRepository } from '../../../booking';
import { TripRepository } from '../../../scheduling';
import { RouteRepository, StopRepository } from '../../../master-data';
import { TenantRepository } from '../../../tenancy';
import { TrackingService } from '../../../tracking';
import { NotificationService } from '../../../notification';
import {
  signingInput,
  encodeToken,
  verifyToken,
  type TicketTokenPayload,
  bookingQrSigningInput,
  verifyBookingQrToken,
  type BookingQrPayload,
} from '../../domain/ticket-token';
import {
  renderTicketEmail,
  renderTicketPage,
  ticketSubject,
  ticketText,
  type TicketView,
} from '../../domain/ticket-document';

export interface IssuedTicket {
  seat: string;
  ticketId?: string | null;
  boardingToken: string; // the QR content: `<payload>.<sig>`
}

/**
 * Ticket issuance & verification.
 *
 * Each confirmed seat gets a compact, HMAC-signed token that encodes the booking,
 * trip and seat. That token IS the QR content — the conductor app scans it and
 * verifies the signature OFFLINE (no network at the boarding point), so a forged
 * or edited ticket fails at the gate. The signing key is derived from the
 * platform secret with domain separation, so a ticket signature can never be
 * replayed as a session token or vice-versa.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly trips: TripRepository,
    private readonly routes: RouteRepository,
    private readonly stops: StopRepository,
    private readonly tenants: TenantRepository,
    private readonly config: AppConfig,
    private readonly tracking: TrackingService,
    private readonly notifications: NotificationService,
  ) {}

  private signingKey(): string {
    // Domain-separated from the JWT secret: a ticket sig ≠ an auth token sig.
    return hmacSha256(this.config.security.jwtSecret, 'ticketly:ticket-signing:v1');
  }

  private sign(payloadPart: string): string {
    return hmacSha256(this.signingKey(), payloadPart);
  }

  /**
   * Tickets (names, seats, boarding QR) are shown only to the booking's
   * operator staff, the signed-in customer who booked it, or someone who
   * gives the booking's mobile number. Anyone else gets "not found", so a
   * guessed or leaked booking id reveals nothing. Runs `fn` in the booking's
   * operator scope.
   */
  async asViewer<T>(
    bookingId: BookingId,
    mobile: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const info = await this.bookings.accessInfo(bookingId);
    const notFound = () =>
      new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    if (!info) throw notFound();
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-10);
    const staff =
      getContext()?.tenantId === info.tenantId && hasPermission(Permission.BOOKING_READ);
    const owner = Boolean(info.customerId) && info.customerId === getUserId();
    const byPhone =
      Boolean(mobile) &&
      digits(mobile).length === 10 &&
      digits(mobile) === digits(info.contactPhone);
    if (!staff && !owner && !byPhone) throw notFound();
    return runAsTenant(info.tenantId as TenantId, fn);
  }

  async issueForBooking(
    bookingId: BookingId,
  ): Promise<{ pnr: string; tickets: IssuedTicket[]; bookingQrToken: string }> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      throw new AppError(ErrorCode.COMMON_PRECONDITION_FAILED, 412, {
        message: 'Only a confirmed booking has tickets',
      });
    }
    const trip = await this.trips.getById(booking.tripId);
    const seats = await this.bookings.loadSeats(bookingId);
    const realTickets = await this.bookings.listTickets(bookingId);
    const idBySeat = new Map(realTickets.map((t) => [t.seatNumber, t.id]));
    // Valid until 12h after departure (covers the whole journey + slack).
    const expiresAtMs = trip.departsAt.getTime() + 12 * 3600 * 1000;
    const issuedAtMs = trip.departsAt.getTime() - 24 * 3600 * 1000; // stable, not wall-clock (deterministic per trip)

    const tickets = seats.map((s) => {
      const payload: TicketTokenPayload = {
        v: 1,
        bookingId,
        pnr: booking.pnr,
        tripId: booking.tripId,
        seat: s.seatNumber,
        issuedAtMs,
        expiresAtMs,
      };
      const part = signingInput(payload);
      return {
        seat: s.seatNumber,
        ticketId: idBySeat.get(s.seatNumber) ?? null,
        boardingToken: encodeToken(part, this.sign(part)),
      };
    });

    // ONE booking-level token — the QR actually printed on the ticket. Same
    // signing key, same expiry window; encodes the PNR, not any one seat.
    const bookingQrPayload: BookingQrPayload = {
      v: 1,
      bookingId,
      pnr: booking.pnr,
      tripId: booking.tripId,
      issuedAtMs,
      expiresAtMs,
    };
    const bookingQrPart = bookingQrSigningInput(bookingQrPayload);
    const bookingQrToken = encodeToken(bookingQrPart, this.sign(bookingQrPart));

    return { pnr: booking.pnr, tickets, bookingQrToken };
  }

  /** Verify a scanned boarding token offline-style (recompute sig + expiry). */
  verify(token: string, nowMs = Date.now()): TicketTokenPayload {
    const payloadPart = token.split('.')[0] ?? '';
    const expected = this.sign(payloadPart);
    return verifyToken(token, expected, nowMs);
  }

  /** Verify a scanned BOOKING-level QR (the one actually printed on the ticket). */
  verifyBookingQr(token: string, nowMs = Date.now()): BookingQrPayload {
    const payloadPart = token.split('.')[0] ?? '';
    const expected = this.sign(payloadPart);
    return verifyBookingQrToken(token, expected, nowMs);
  }

  /** Everything a printed or emailed ticket shows, for a confirmed booking (operator scope). */
  async ticketView(bookingId: BookingId): Promise<TicketView> {
    const { pnr, bookingQrToken } = await this.issueForBooking(bookingId);
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

    const trip = await this.trips.getById(booking.tripId);
    const trackingUrl = this.tracking.buildTrackingUrl(
      this.tracking.issueTrackingToken(bookingId, booking.tripId, pnr, trip.arrivesAt),
    );
    const route = await this.routes.getById(trip.routeId);
    const fromStop = route.path.stops.find((s) => s.sequence === booking.fromSeq);
    const toStop = route.path.stops.find((s) => s.sequence === booking.toSeq);
    const stopIds = [fromStop?.stopId, toStop?.stopId].filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
    const stopNames = await this.stops.loadMany(stopIds);
    const fromDetail = fromStop ? stopNames.get(fromStop.stopId) : undefined;
    const toDetail = toStop ? stopNames.get(toStop.stopId) : undefined;

    const operator = await this.tenants.getGstDetails();
    const tenant = (await this.tenants.findById(requireTenantId()))?.snapshot();
    const passengers = await this.bookings.loadPassengers(bookingId);
    passengers.sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true }));

    return {
      operatorName: tenant?.displayName ?? operator?.legalName ?? 'Bus operator',
      operatorGstin: operator?.gstin ?? null,
      operatorPhone: tenant?.contactPhone ?? null,
      logoDataUri: await this.tenants.getLogoUrl(),
      pnr,
      seatType: null,
      from: {
        name: fromDetail?.name ?? 'Boarding point',
        landmark: fromDetail?.landmark ?? null,
        at: route.path.instantAt(booking.fromSeq, trip.departsAt, 'depart'),
      },
      to: {
        name: toDetail?.name ?? 'Dropping point',
        landmark: toDetail?.landmark ?? null,
        at: route.path.instantAt(booking.toSeq, trip.departsAt, 'arrive'),
      },
      passengers: passengers.map((p) => ({
        seat: p.seatNumber,
        name: p.fullName,
        age: p.age,
        gender: p.gender,
      })),
      fareMinor: booking.totalMinor - booking.taxMinor,
      taxMinor: booking.taxMinor,
      totalMinor: booking.totalMinor,
      currency: tenant?.currency ?? 'INR',
      trackingUrl,
      qrToken: bookingQrToken,
      timeZone: tenant?.timezone ?? 'Asia/Kolkata',
    };
  }

  /** A self-contained, printable HTML ticket; the QR is drawn server-side (no scripts). */
  async renderHtml(bookingId: BookingId): Promise<string> {
    const view = await this.ticketView(bookingId);
    const svg = await QRCode.toString(view.qrToken, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    return renderTicketPage(view, svg);
  }

  /**
   * Email the e-ticket to the booking's email address, once per confirmation
   * event (a redelivered event sends nothing). The operator's own
   * confirmation email template, when it has one, is the subject and the
   * opening text. The GST invoice goes separately (InvoiceService). Returns
   * false when there is no email address or it was already sent.
   */
  async emailTicket(bookingId: BookingId, eventId: Uuid): Promise<boolean> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking?.contactEmail) return false;
    if (booking.status !== 'confirmed' && booking.status !== 'completed') return false;
    const view = await this.ticketView(bookingId);
    const tenantId = requireTenantId();
    const own = await this.notifications.renderOperatorTemplate(
      tenantId,
      'booking.confirmed',
      'email',
      {
        pnr: view.pnr,
      },
    );
    view.intro = own?.body ?? null;
    const qrPng = await QRCode.toBuffer(view.qrToken, {
      type: 'png',
      width: 330,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    const cid = `qr-${view.pnr}@ticket`;
    return this.notifications.sendBookingDocument({
      tenantId,
      eventId,
      bookingId,
      kind: 'eticket',
      to: booking.contactEmail,
      subject: own?.subject || ticketSubject(view),
      html: renderTicketEmail(view, cid),
      text: ticketText(view),
      attachments: [
        { filename: `boarding-qr-${view.pnr}.png`, content: qrPng, contentType: 'image/png', cid },
      ],
    });
  }
}
