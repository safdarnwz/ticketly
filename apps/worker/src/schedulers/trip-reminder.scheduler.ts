import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import { runInNewContext, requireTenantId, type Json, type TenantId } from '@kernel';
import { Logger } from '@observability';

import { TrackingService, formatLocalTime, trackingStartsAt } from '@api/modules/tracking';

/**
 * ============================================================================
 *  Three PER-PASSENGER journey reminders — 8h, 4h and 1h before boarding
 * ============================================================================
 *
 * Runs every 10 minutes (see SchedulerService), sweeping BOOKINGS (not
 * trips) whose passenger's own boarding-stop time is within each window —
 * NOT the trip's origin departure time. On a long multi-stop route
 * (Kolkata -> ... -> Sasaram -> ... -> Delhi), a passenger boarding at
 * Sasaram boards many hours after the bus leaves Kolkata; reminding them
 * relative to Kolkata's departure would be meaningless to them. Each
 * booking's own boarding instant is `trip.departs_at + that stop's
 * depart_offset_min` (route_stops stores every stop's offset already
 * relative to the route's origin).
 *
 * Each goes out by SMS, WhatsApp and email and fires independently (a
 * booking made five hours ahead gets only the 4h and 1h ones) — hence one
 * idempotency column per stage (migrations 0039, 0106):
 *   - 8h: passenger names, PNR, seats, boarding/dropping point names and
 *     times — no tracking link yet; it says the link comes at 4h.
 *   - 4h: the details needed to physically board — exact pickup location,
 *     bus number, EVERY driver on duty (a long run has two or three, a
 *     short one a single driver) and the conductor / attendants, each with
 *     name and mobile — plus the live-tracking link (the bus shows on it
 *     from an hour before departure).
 *   - 1h: the last reminder, same details — the bus is now live on the map.
 */
export type ReminderStage = '8h' | '4h' | '1h';

const STAGES: {
  stage: ReminderStage;
  column: 'reminder_8h_sent_at' | 'reminder_4h_sent_at' | 'reminder_1h_sent_at';
  windowStart: string;
  windowEnd: string;
}[] = [
  {
    stage: '8h',
    column: 'reminder_8h_sent_at',
    windowStart: '7 hours 50 minutes',
    windowEnd: '8 hours 10 minutes',
  },
  {
    stage: '4h',
    column: 'reminder_4h_sent_at',
    windowStart: '3 hours 50 minutes',
    windowEnd: '4 hours 10 minutes',
  },
  {
    stage: '1h',
    column: 'reminder_1h_sent_at',
    windowStart: '50 minutes',
    windowEnd: '1 hour 10 minutes',
  },
];

@Injectable()
export class TripReminderScheduler {
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly tracking: TrackingService,
    logger: Logger,
  ) {
    this.log = logger.forContext('TripReminderScheduler');
  }

  async run(): Promise<Record<ReminderStage, number>> {
    const sent = { '8h': 0, '4h': 0, '1h': 0 };
    for (const st of STAGES) {
      sent[st.stage] = await this.sweep({
        ...st,
        build: (ctx) =>
          st.stage === '8h'
            ? this.buildTripPayload(ctx.bookingId)
            : this.buildBoardingPayload(ctx.bookingId, st.stage),
      });
    }
    return sent;
  }

  private async sweep(opts: {
    column: (typeof STAGES)[number]['column'];
    windowStart: string;
    windowEnd: string;
    build: (ctx: { bookingId: string }) => Promise<Record<string, unknown> | null>;
  }): Promise<number> {
    // Cross-tenant sweep — bypassRls is ONLY valid inside a UnitOfWork scope,
    // never on a plain db.query — this is a background job with no ambient
    // tenant bound, so it deliberately runs in its own bypass-scoped
    // transaction to find EVERY operator's due bookings in one query, then
    // processes each tenant's under its own bound context below (same as
    // PayoutScheduler's pattern).
    const due = await this.uow.run(
      { name: `tripReminder.due.${opts.column}`, bypassRls: true },
      async (scope) =>
        scope.client.query<{ tenant_id: string; booking_id: string }>(
          `SELECT b.tenant_id, b.id AS booking_id
           FROM bookings b
           JOIN trips t ON t.tenant_id = b.tenant_id AND t.id = b.trip_id
           JOIN route_stops board_rs ON board_rs.tenant_id = b.tenant_id
                                     AND board_rs.route_id = b.route_id
                                     AND board_rs.sequence = b.from_seq
          WHERE b.status = 'confirmed' AND b.${opts.column} IS NULL
            -- Not cancelled and not already over (a passenger boarding
            -- mid-route may be reminded while the bus is on its way).
            AND t.status <> 'cancelled' AND t.actual_arrived_at IS NULL
            AND (t.departs_at + (board_rs.depart_offset_min || ' minutes')::interval)
                BETWEEN now() + interval '${opts.windowStart}' AND now() + interval '${opts.windowEnd}'`,
        ),
    );

    let notified = 0;
    for (const row of due.rows) {
      try {
        await runInNewContext(
          { tenantId: row.tenant_id as TenantId, actorType: 'system' },
          async () => {
            const payload = await opts.build({ bookingId: row.booking_id });
            if (!payload) return; // booking vanished between the sweep and here
            // Event + "sent" flag in ONE transaction: publish() throws outside a
            // transaction (so no reminder was ever sent before), and doing both
            // atomically means a reminder is marked sent iff it was really
            // queued. The IS NULL guard stops a concurrent sweep double-sending.
            await this.uow.run(
              { name: `tripReminder.send.${opts.column}`, tenantId: row.tenant_id as TenantId },
              async (scope) => {
                const claimed = await scope.client.query(
                  `UPDATE bookings SET ${opts.column} = now() WHERE tenant_id = $1 AND id = $2 AND ${opts.column} IS NULL RETURNING id`,
                  [requireTenantId(), row.booking_id],
                );
                if (claimed.rowCount === 0) return;
                this.events.publish({
                  type: `trip.reminder.${payload.stage}`,
                  aggregateType: 'trip',
                  aggregateId: payload.tripId as string,
                  payload: payload as unknown as Json,
                });
              },
            );
          },
        );
        notified += 1;
      } catch (err) {
        this.log.error(
          { err, bookingId: row.booking_id, tenantId: row.tenant_id, stage: opts.column },
          'trip reminder failed for this booking — will retry next sweep since the flag is only set on success',
        );
      }
    }
    if (due.rows.length > 0)
      this.log.info({ stage: opts.column, due: due.rows.length, notified }, 'trip reminders sent');
    return notified;
  }

  /** 8h: the full "here's your trip" picture — no tracking link yet, that comes at 4h. */
  private async buildTripPayload(bookingId: string): Promise<Record<string, unknown> | null> {
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
  private async buildBoardingPayload(
    bookingId: string,
    stage: '4h' | '1h',
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
      passengers: await this.passengers(bookingId),
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
