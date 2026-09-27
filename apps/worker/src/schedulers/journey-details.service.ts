import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId } from '@kernel';

import { TrackingService, formatLocalTime, trackingStartsAt } from '@api/modules/tracking';

/** What a passenger was told: bus, every driver and crew member, their seats. */
function detailsHash(
  bus: string | null,
  drivers: { name: string; phone: string | null }[],
  attendants: { name: string; phone: string | null }[],
  passengers: { seat: string }[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        bus,
        drivers.map((d) => [d.name, d.phone]),
        attendants.map((a) => [a.name, a.phone]),
        passengers.map((p) => p.seat),
      ]),
    )
    .digest('hex')
    .slice(0, 32);
}

/**
 * What a passenger needs to know about their journey, read fresh from the
 * trip at the moment of sending: the trip picture (8-hour reminder) and the
 * boarding details — pickup, the bus the trip has now, every driver and
 * crew member on it with their mobile, their seats, the tracking link — for
 * the 4-hour and 1-hour reminders and for a notice when the bus or crew
 * changes after they were told.
 */
@Injectable()
export class JourneyDetailsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tracking: TrackingService,
  ) {}

  /** 8h: the full "here's your trip" picture — no tracking link yet, that comes at 4h. */
  async trip(bookingId: string): Promise<Record<string, unknown> | null> {
    const booking = await this.db.queryOne<{
      pnr: string;
      trip_id: string;
      contact_phone: string | null;
      contact_email: string | null;
      from_stop_name: string;
      to_stop_name: string;
      boarding_at: Date;
      dropping_at: Date;
      timezone: string;
    }>(
      `SELECT b.pnr, b.trip_id, b.contact_phone, b.contact_email,
              fs.name AS from_stop_name, ts.name AS to_stop_name,
              t.departs_at + (frs.depart_offset_min || ' minutes')::interval AS boarding_at,
              t.departs_at + (trs.depart_offset_min || ' minutes')::interval AS dropping_at,
              te.timezone
         FROM bookings b
         JOIN trips t ON t.tenant_id = b.tenant_id AND t.id = b.trip_id
         JOIN tenants te ON te.id = b.tenant_id
         JOIN route_stops frs ON frs.tenant_id = b.tenant_id AND frs.route_id = b.route_id AND frs.sequence = b.from_seq
         JOIN route_stops trs ON trs.tenant_id = b.tenant_id AND trs.route_id = b.route_id AND trs.sequence = b.to_seq
         JOIN stops fs ON fs.id = frs.stop_id
         JOIN stops ts ON ts.id = trs.stop_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.trip.booking' },
    );
    if (!booking) return null;

    return {
      stage: '8h',
      pnr: booking.pnr,
      tripId: booking.trip_id,
      contactPhone: booking.contact_phone,
      contactEmail: booking.contact_email,
      passengers: await this.passengers(bookingId),
      fromStopName: booking.from_stop_name,
      toStopName: booking.to_stop_name,
      boardingAt: formatLocalTime(booking.boarding_at, booking.timezone),
      droppingAt: formatLocalTime(booking.dropping_at, booking.timezone),
    };
  }

  /**
   * 4h and 1h: what is needed to physically board — pickup point, bus
   * number, every driver and conductor / attendant with their mobile, and
   * the live-tracking link.
   */
  async boarding(
    bookingId: string,
    stage: '4h' | '1h' | 'update',
  ): Promise<Record<string, unknown> | null> {
    const booking = await this.db.queryOne<{
      pnr: string;
      trip_id: string;
      contact_phone: string | null;
      contact_email: string | null;
      from_stop_name: string;
      to_stop_name: string;
      landmark: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      stop_contact_phone: string | null;
      registration_no: string | null;
      boarding_at: Date;
      departs_at: Date;
      arrives_at: Date;
      timezone: string;
    }>(
      `SELECT b.pnr, b.trip_id, b.contact_phone, b.contact_email,
              fs.name AS from_stop_name, ts.name AS to_stop_name,
              fs.landmark, fs.address, fs.latitude, fs.longitude, fs.contact_phone AS stop_contact_phone,
              v.registration_no,
              t.departs_at + (frs.depart_offset_min || ' minutes')::interval AS boarding_at,
              t.departs_at, t.arrives_at, te.timezone
         FROM bookings b
         JOIN trips t ON t.tenant_id = b.tenant_id AND t.id = b.trip_id
         JOIN tenants te ON te.id = b.tenant_id
         JOIN route_stops frs ON frs.tenant_id = b.tenant_id AND frs.route_id = b.route_id AND frs.sequence = b.from_seq
         JOIN route_stops trs ON trs.tenant_id = b.tenant_id AND trs.route_id = b.route_id AND trs.sequence = b.to_seq
         JOIN stops fs ON fs.id = frs.stop_id
         JOIN stops ts ON ts.id = trs.stop_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.boarding.booking' },
    );
    if (!booking) return null;

    // Same live-tracking link the e-ticket carries (TicketService.issueForBooking),
    // repeated as its own short "track your bus" message a passenger can tap
    // when they need it.
    const trackingToken = this.tracking.issueTrackingToken(
      bookingId,
      booking.trip_id,
      booking.pnr,
      booking.arrives_at,
    );
    const trackingUrl = this.tracking.buildTrackingUrl(trackingToken);

    // EVERY driver and conductor / attendant on duty — a long overnight run
    // has two or three drivers taking turns, a short one a single driver.
    // The roster may still be empty (it sometimes fills in late).
    const crew = await this.tracking.tripCrew(booking.trip_id);
    const passengers = await this.passengers(bookingId);
    const drivers = crew.filter((c) => c.role === 'driver');
    const attendants = crew.filter((c) => c.role !== 'driver');
    const person = (c: { name: string; phone: string | null }) =>
      `${c.name} (${c.phone ?? 'no phone on file'})`;
    const list = (people: typeof crew) =>
      people.length > 0 ? people.map(person).join(', ') : 'Not yet assigned';
    const fmt = (d: Date) => formatLocalTime(d, booking.timezone);

    return {
      stage,
      pnr: booking.pnr,
      tripId: booking.trip_id,
      contactPhone: booking.contact_phone,
      contactEmail: booking.contact_email,
      passengers,
      fromStopName: booking.from_stop_name,
      toStopName: booking.to_stop_name,
      pickup: {
        stopName: booking.from_stop_name,
        landmark: booking.landmark,
        address: booking.address,
        latitude: booking.latitude,
        longitude: booking.longitude,
        stopContactPhone: booking.stop_contact_phone,
      },
      boardingAt: fmt(booking.boarding_at),
      busNumber: booking.registration_no,
      // The first driver / attendant, for templates still using the older
      // singular fields; new ones use the lists, which never drop a co-driver.
      driver: drivers[0] ? { name: drivers[0].name, phone: drivers[0].phone } : null,
      attendant: attendants[0] ? { name: attendants[0].name, phone: attendants[0].phone } : null,
      drivers: drivers.map((d) => ({ name: d.name, phone: d.phone })),
      attendants: attendants.map((a) => ({ role: a.role, name: a.name, phone: a.phone })),
      driversList: list(drivers),
      attendantsList: list(attendants),
      // One line per person for WhatsApp / email: "Driver 1: Ramesh (98…)".
      crewList:
        crew.length > 0
          ? crew.map((c) => `${this.roleLabel(c, drivers)}: ${person(c)}`).join('\n')
          : 'Crew not yet assigned — the operator will share it before departure',
      trackingUrl,
      trackingStartsAt: fmt(trackingStartsAt({ departsAt: booking.departs_at })),
      detailsHash: detailsHash(booking.registration_no, drivers, attendants, passengers),
    };
  }

  /** "Driver 1" / "Driver 2" when several take turns; "Conductor", "Attendant". */
  private roleLabel(c: { role: string }, drivers: { role: string }[]): string {
    if (c.role === 'driver' && drivers.length > 1) return `Driver ${drivers.indexOf(c) + 1}`;
    return `${c.role[0].toUpperCase()}${c.role.slice(1)}`;
  }

  private async passengers(bookingId: string): Promise<{ seat: string; name: string }[]> {
    const rows = await this.db.query<{ seat_number: string; full_name: string }>(
      `SELECT seat_number, full_name FROM passengers WHERE tenant_id = $1 AND booking_id = $2 ORDER BY seat_number`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.passengers' },
    );
    return rows.map((p) => ({ seat: p.seat_number, name: p.full_name }));
  }
}
