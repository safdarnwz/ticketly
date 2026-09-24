import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import { runInNewContext, requireTenantId, type Json, type TenantId } from '@kernel';
import { Logger } from '@observability';

import { TrackingService } from '@api/modules/tracking/application/services/tracking.service';

/**
 * ============================================================================
 *  Two-stage PER-PASSENGER trip reminders — 12h and 4h before boarding
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
 * The two reminders carry DIFFERENT content and fire independently (a
 * booking can be due for one without the other) — hence two idempotency
 * columns (migration 0039):
 *   - 12h: passenger names, PNR, seats, boarding/dropping point NAMES and
 *     times — no live-tracking link, since the bus isn't running yet.
 *   - 4h: the operational details needed to physically board — exact
 *     pickup location (landmark/address/coordinates), the assigned
 *     driver's and attendant's names + phone numbers, and the bus's
 *     registration number.
 */
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

  async run(): Promise<{ twelveHour: number; fourHour: number }> {
    const twelveHour = await this.sweep({
      column: 'reminder_12h_sent_at',
      windowStart: '11 hours 50 minutes',
      windowEnd: '12 hours 10 minutes',
      build: (ctx) => this.buildTwelveHourPayload(ctx.bookingId),
    });
    const fourHour = await this.sweep({
      column: 'reminder_4h_sent_at',
      windowStart: '3 hours 50 minutes',
      windowEnd: '4 hours 10 minutes',
      build: (ctx) => this.buildFourHourPayload(ctx.bookingId),
    });
    return { twelveHour, fourHour };
  }

  private async sweep(opts: {
    column: 'reminder_12h_sent_at' | 'reminder_4h_sent_at';
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
            AND t.status IN ('open','closed')
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

  /** 12h: the full "here's your trip" picture — no live-tracking link, the bus isn't running yet. */
  private async buildTwelveHourPayload(bookingId: string): Promise<Record<string, unknown> | null> {
    const booking = await this.db.queryOne<{
      pnr: string;
      trip_id: string;
      contact_phone: string | null;
      contact_email: string | null;
      from_stop_name: string;
      to_stop_name: string;
      boarding_at: Date;
      dropping_at: Date;
    }>(
      `SELECT b.pnr, b.trip_id, b.contact_phone, b.contact_email,
              fs.name AS from_stop_name, ts.name AS to_stop_name,
              t.departs_at + (frs.depart_offset_min || ' minutes')::interval AS boarding_at,
              t.departs_at + (trs.depart_offset_min || ' minutes')::interval AS dropping_at
         FROM bookings b
         JOIN trips t ON t.tenant_id = b.tenant_id AND t.id = b.trip_id
         JOIN route_stops frs ON frs.tenant_id = b.tenant_id AND frs.route_id = b.route_id AND frs.sequence = b.from_seq
         JOIN route_stops trs ON trs.tenant_id = b.tenant_id AND trs.route_id = b.route_id AND trs.sequence = b.to_seq
         JOIN stops fs ON fs.id = frs.stop_id
         JOIN stops ts ON ts.id = trs.stop_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.twelveHour.booking' },
    );
    if (!booking) return null;

    const passengers = await this.db.query<{ seat_number: string; full_name: string }>(
      `SELECT seat_number, full_name FROM passengers WHERE tenant_id = $1 AND booking_id = $2 ORDER BY seat_number`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.twelveHour.passengers' },
    );

    return {
      stage: '12h',
      pnr: booking.pnr,
      tripId: booking.trip_id,
      contactPhone: booking.contact_phone,
      contactEmail: booking.contact_email,
      passengers: passengers.map((p) => ({ seat: p.seat_number, name: p.full_name })),
      fromStopName: booking.from_stop_name,
      toStopName: booking.to_stop_name,
      boardingAt: booking.boarding_at,
      droppingAt: booking.dropping_at,
    };
  }

  /** 4h: the operational details needed to physically board — pickup location, driver/attendant, bus number. NO GPS link, per spec. */
  private async buildFourHourPayload(bookingId: string): Promise<Record<string, unknown> | null> {
    const booking = await this.db.queryOne<{
      pnr: string;
      trip_id: string;
      contact_phone: string | null;
      contact_email: string | null;
      from_stop_name: string;
      landmark: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      stop_contact_phone: string | null;
      registration_no: string | null;
      boarding_at: Date;
      arrives_at: Date;
    }>(
      `SELECT b.pnr, b.trip_id, b.contact_phone, b.contact_email,
              fs.name AS from_stop_name, fs.landmark, fs.address, fs.latitude, fs.longitude, fs.contact_phone AS stop_contact_phone,
              v.registration_no,
              t.departs_at + (frs.depart_offset_min || ' minutes')::interval AS boarding_at,
              t.arrives_at
         FROM bookings b
         JOIN trips t ON t.tenant_id = b.tenant_id AND t.id = b.trip_id
         JOIN route_stops frs ON frs.tenant_id = b.tenant_id AND frs.route_id = b.route_id AND frs.sequence = b.from_seq
         JOIN stops fs ON fs.id = frs.stop_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [requireTenantId(), bookingId],
      { name: 'tripReminder.fourHour.booking' },
    );
    if (!booking) return null;

    // Same live-tracking link the e-ticket carries (TicketService.issueForBooking)
    // — repeated here as its OWN, standalone message, matching how real
    // operator platforms send it: a short, dedicated "track your bus"
    // text a passenger can tap right when they need it, not buried inside
    // a longer ticket message they may have archived hours ago.
    const trackingToken = this.tracking.issueTrackingToken(
      bookingId,
      booking.trip_id,
      booking.pnr,
      booking.arrives_at,
    );
    const trackingUrl = this.tracking.buildTrackingUrl(trackingToken);

    // ALL drivers + attendants on duty for this trip — a long overnight
    // route commonly has 2-3 drivers on shift-rotation (and sometimes more
    // than one attendant), not just one of each. Collecting only the FIRST
    // match here would silently drop every co-driver from the passenger's
    // notification — exactly the kind of thing that looks fine on a short
    // route (where there's only ever one) and quietly breaks on a long one.
    // A duty may not have been assigned yet at all (a real roster sometimes
    // fills in late), so this can legitimately be an empty list.
    const crewRows = await this.db.query<{ role: string; full_name: string; phone: string | null }>(
      `SELECT c.role, c.full_name, c.phone
         FROM crew_duties cd JOIN crew c ON c.id = cd.crew_id
        WHERE cd.tenant_id = $1 AND cd.trip_id = $2 AND cd.status = 'assigned'
        ORDER BY cd.starts_at`,
      [requireTenantId(), booking.trip_id],
      { name: 'tripReminder.fourHour.crew' },
    );
    const drivers = crewRows.filter((c) => c.role === 'driver');
    const attendants = crewRows.filter((c) => c.role === 'conductor' || c.role === 'attendant');
    const fmtCrew = (list: typeof crewRows) =>
      list.length > 0
        ? list.map((c) => `${c.full_name} (${c.phone ?? 'no phone on file'})`).join(', ')
        : 'Not yet assigned';

    return {
      stage: '4h',
      pnr: booking.pnr,
      tripId: booking.trip_id,
      contactPhone: booking.contact_phone,
      contactEmail: booking.contact_email,
      pickup: {
        stopName: booking.from_stop_name,
        landmark: booking.landmark,
        address: booking.address,
        latitude: booking.latitude,
        longitude: booking.longitude,
        stopContactPhone: booking.stop_contact_phone,
      },
      boardingAt: booking.boarding_at,
      busNumber: booking.registration_no,
      // Kept for any template still using the OLD singular fields (the
      // FIRST driver/attendant, if any) — new templates should prefer
      // driversList/attendantsList below, which never drop a co-driver.
      driver: drivers[0] ? { name: drivers[0].full_name, phone: drivers[0].phone } : null,
      attendant: attendants[0]
        ? { name: attendants[0].full_name, phone: attendants[0].phone }
        : null,
      driversList: fmtCrew(drivers),
      attendantsList: fmtCrew(attendants),
      trackingUrl,
    };
  }
}
