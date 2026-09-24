import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { AppError, ErrorCode, type BookingId } from '@kernel';
import { hmacSha256 } from '@security';

import { BookingRepository } from '../../../booking';
import { TripRepository } from '../../../scheduling';
import { RouteRepository, StopRepository } from '../../../master-data';
import { TenantRepository } from '../../../tenancy';
import { TrackingService } from '../../../tracking';
import {
  signingInput,
  encodeToken,
  verifyToken,
  type TicketTokenPayload,
  bookingQrSigningInput,
  verifyBookingQrToken,
  type BookingQrPayload,
} from '../../domain/ticket-token';

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
  ) {}

  private signingKey(): string {
    // Domain-separated from the JWT secret: a ticket sig ≠ an auth token sig.
    return hmacSha256(this.config.security.jwtSecret, 'ticketly:ticket-signing:v1');
  }

  private sign(payloadPart: string): string {
    return hmacSha256(this.signingKey(), payloadPart);
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

  /** A self-contained, printable HTML ticket carrying the boarding tokens. */
  async renderHtml(bookingId: BookingId): Promise<string> {
    const { pnr, tickets, bookingQrToken } = await this.issueForBooking(bookingId);
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

    const trip = await this.trips.getById(booking.tripId);
    const trackingToken = this.tracking.issueTrackingToken(
      bookingId,
      booking.tripId,
      pnr,
      trip.arrivesAt,
    );
    const trackingUrl = this.tracking.buildTrackingUrl(trackingToken);
    const route = await this.routes.getById(trip.routeId);
    const origin = route.path.stops[0];
    const fromStop = route.path.stops.find((s) => s.sequence === booking.fromSeq);
    const toStop = route.path.stops.find((s) => s.sequence === booking.toSeq);
    const stopIds = [fromStop?.stopId, toStop?.stopId].filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
    const stopNames = await this.stops.loadMany(stopIds);
    const fromDetail = fromStop ? stopNames.get(fromStop.stopId) : undefined;
    const toDetail = toStop ? stopNames.get(toStop.stopId) : undefined;
    const fromName = fromDetail?.name ?? 'Boarding point';
    const toName = toDetail?.name ?? 'Dropping point';

    // trip.departsAt is the ORIGIN's departure instant. Each stop's own
    // clock time is an offset from origin (dayOffset*1440 + minute) — the
    // DIFFERENCE between a stop's offset and the origin's gives exactly how
    // many minutes to shift trip.departsAt to land on THAT stop's actual
    // time, which is what a passenger boarding or alighting midway through
    // the route actually experiences (never just the trip's overall
    // start/end time, unless they happen to be at the origin/destination).
    const originOffset = origin ? origin.departDayOffset * 1440 + origin.departMinute : 0;
    const toClock = (s: typeof fromStop, useArrival: boolean) => {
      if (!s) return null;
      const offset = useArrival
        ? s.arrivalDayOffset * 1440 + s.arrivalMinute
        : s.departDayOffset * 1440 + s.departMinute;
      return new Date(trip.departsAt.getTime() + (offset - originOffset) * 60_000);
    };
    const boardingTime = toClock(fromStop, false);
    const arrivalTime = toClock(toStop, true);
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const fmtTime = (d: Date) =>
      d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const operator = await this.tenants.getGstDetails();
    const logoDataUri = await this.tenants.getLogoUrl();
    const passengers = await this.bookings.loadPassengers(bookingId);
    const nameBySeat = new Map(passengers.map((p) => [p.seatNumber, p.fullName]));

    const fareMinor = booking.totalMinor - booking.taxMinor;
    const money = (m: number) => `₹${(m / 100).toFixed(2)}`;

    const rows = tickets
      .map(
        (t) => `
      <div class="seat">
        <div class="seat-no">Seat ${escapeHtml(t.seat)}</div>
        <div class="pax-name">${escapeHtml(nameBySeat.get(t.seat) ?? '—')}</div>
      </div>`,
      )
      .join('');

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(operator?.legalName ?? 'Bus')} Ticket ${escapeHtml(pnr)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#111}
  .ticket{max-width:680px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden}
  .head{background:#0b5;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
  .head h1{margin:0;font-size:20px}
  .head .gstin{font-size:11px;opacity:.85}
  .pnr{font-size:13px;opacity:.9;margin-top:8px}
  .qr-box{background:#fff;padding:6px;border-radius:8px}
  .qr-caption{font-size:9px;color:#fff;opacity:.85;text-align:center;margin-top:4px}
  .journey{padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between}
  .journey .stop{font-weight:600;font-size:14px}
  .journey .landmark{font-size:11px;color:#888;margin-top:2px}
  .journey .label{font-size:11px;color:#666;margin-top:4px}
  .journey .time{font-weight:600;font-size:13px;margin-top:1px}
  .body{padding:8px 20px}
  .seat{display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #ccc;padding:12px 0}
  .seat-no{font-weight:600}
  .pax-name{font-size:13px;color:#666}
  .fare{padding:16px 20px;border-top:1px solid #eee;font-size:13px}
  .fare-row{display:flex;justify-content:space-between;padding:2px 0}
  .fare-total{font-weight:700;border-top:1px solid #ddd;margin-top:6px;padding-top:6px}
  .foot{padding:12px 20px;font-size:11px;color:#888;border-top:1px solid #eee}
</style></head>
<body><div class="ticket">
  <div class="head">
    ${logoDataUri ? `<img src="${escapeHtml(logoDataUri)}" alt="${escapeHtml(operator?.legalName ?? 'Operator')} logo" style="max-height:56px;max-width:140px;object-fit:contain;margin-bottom:8px" />` : ''}
    <div>
      <h1>${escapeHtml(operator?.legalName ?? 'Bus Operator')}</h1>
      ${operator?.gstin ? `<div class="gstin">GSTIN: ${escapeHtml(operator.gstin)}</div>` : ''}
      <div class="pnr">PNR ${escapeHtml(pnr)} · ${tickets.length} seat${tickets.length > 1 ? 's' : ''}</div>
      <div class="track-link"><a href="${escapeHtml(trackingUrl)}" target="_blank" style="color:#fff;text-decoration:underline">📍 Track your bus live</a></div>
    </div>
    <div>
      <div class="qr-box" id="pnr-qr"></div>
      <div class="qr-caption">Scan to check in</div>
    </div>
  </div>
  <div class="journey">
    <div>
      <div class="stop">${escapeHtml(fromName)}</div>
      ${fromDetail?.landmark ? `<div class="landmark">${escapeHtml(fromDetail.landmark)}</div>` : ''}
      <div class="label">Boarding at</div>
      ${boardingTime ? `<div class="time">${escapeHtml(fmtDate(boardingTime))}, ${escapeHtml(fmtTime(boardingTime))}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="stop">${escapeHtml(toName)}</div>
      ${toDetail?.landmark ? `<div class="landmark">${escapeHtml(toDetail.landmark)}</div>` : ''}
      <div class="label">Arrival at</div>
      ${arrivalTime ? `<div class="time">${escapeHtml(fmtDate(arrivalTime))}, ${escapeHtml(fmtTime(arrivalTime))}</div>` : ''}
    </div>
  </div>
  <div class="body">${rows}</div>
  <div class="fare">
    <div class="fare-row"><span>Fare</span><span>${money(fareMinor)}</span></div>
    <div class="fare-row"><span>GST</span><span>${money(booking.taxMinor)}</span></div>
    <div class="fare-row fare-total"><span>Total paid</span><span>${money(booking.totalMinor)}</span></div>
  </div>
  <div class="foot">${escapeHtml(operator?.legalName ?? 'Operator')} is the transport provider for this journey. Booked via Ticketly. Scan the QR above to check in — one passenger checks in instantly, a group is checked in one by one as each person boards.</div>
</div>
<script>new QRCode(document.getElementById('pnr-qr'), { text: ${JSON.stringify(bookingQrToken)}, width: 84, height: 84, correctLevel: QRCode.CorrectLevel.M });</script>
</body></html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
