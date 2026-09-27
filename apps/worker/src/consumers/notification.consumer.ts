import { DatabaseService } from '@database';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { runInNewContext, type DomainEvent } from '@kernel';

import { NotificationService } from '@api/modules/notification/application/services/notification.service';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';
import { JourneyDetailsService } from '../schedulers/journey-details.service';

/**
 * Subscribes to booking/trip events and turns them into notifications.
 *
 * This is the concrete payoff of the event-driven design: adding "notify on
 * confirmation" touched only this file — the booking module never knew about
 * notifications. The handler is idempotent (the notification log de-dupes on
 * (event, channel, recipient)), which is required because the outbox delivers
 * at-least-once.
 */
@Injectable()
export class NotificationConsumer implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly notifications: NotificationService,
    private readonly db: DatabaseService,
    private readonly journeys: JourneyDetailsService,
  ) {}

  onModuleInit(): void {
    for (const type of [
      'booking.confirmed',
      'booking.cancelled',
      'booking.seats_cancelled',
      'refund.settled',
      'connection.at_risk',
      'connection.broken',
    ]) {
      this.dispatcher.register(this.handlerFor(type));
    }
    for (const type of ['trip.delayed', 'trip.retimed', 'trip.diverted'])
      this.dispatcher.register(this.tripPassengersHandler(type));
    for (const stage of ['8h', '4h', '1h'] as const)
      this.dispatcher.register(this.tripReminderHandler(stage));
    for (const type of ['trip.vehicle_changed', 'trip.crew_changed'])
      this.dispatcher.register(this.detailsChangedHandler(type));
    this.dispatcher.register(this.waitlistHandler());
    this.dispatcher.register(this.criticalIncidentHandler());
  }

  /** SOS / medical / security / accident → the operator's emergency contacts, immediately. */
  private criticalIncidentHandler(): EventHandler {
    return {
      eventType: 'incident.critical',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const t = await this.db.queryOne<{
          contact_phone: string | null;
          contact_email: string | null;
        }>(`SELECT contact_phone, contact_email FROM tenants WHERE id = $1`, [event.tenantId], {
          name: 'notify.emergencyContacts',
          primary: true,
        });
        if (!t?.contact_phone && !t?.contact_email) return;
        const p = event.payload as {
          lat?: number | null;
          lng?: number | null;
          type?: string;
          tripId?: string;
          description?: string;
        };
        const location =
          p.lat != null && p.lng != null
            ? `https://maps.google.com/?q=${p.lat},${p.lng}`
            : 'not shared';
        await this.notifications.notify({
          tenantId: event.tenantId,
          eventId: event.eventId,
          eventType: 'incident.critical',
          recipients: { sms: t.contact_phone ?? undefined, email: t.contact_email ?? undefined },
          data: {
            type: (p.type ?? 'sos').toUpperCase(),
            tripId: p.tripId ?? '—',
            time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            location,
            description: p.description ?? '',
          },
        });
      },
    };
  }

  private waitlistHandler(): EventHandler {
    return {
      eventType: 'waitlist.seats_available',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as {
          contactPhone?: string;
          contactEmail?: string;
          seatCount?: number;
          routeName?: string;
          journeyDate?: string;
          bookUrl?: string;
        };
        const recipients = { sms: p.contactPhone ?? undefined, email: p.contactEmail ?? undefined };
        if (!recipients.sms && !recipients.email) return;
        await this.notifications.notify({
          tenantId: event.tenantId,
          eventId: event.eventId,
          eventType: 'waitlist.seats_available',
          recipients,
          data: {
            seatCount: p.seatCount ?? '',
            routeName: p.routeName,
            journeyDate: p.journeyDate,
            bookUrl: p.bookUrl,
          },
        });
      },
    };
  }

  /**
   * The journey reminders (8h, 4h, 1h — see TripReminderScheduler) carry a
   * richer payload than the generic handlerFor() below extracts, so they get
   * their own handler that flattens it into exactly the placeholder names the
   * templates use, and send it by SMS, WhatsApp and email. renderTemplate()'s
   * placeholder regex allows dots WITHIN a single key name (flat lookup, not
   * nested property access) — so `data['pickup.stopName']` as a literal key
   * is what makes `{{pickup.stopName}}` resolve.
   */
  private tripReminderHandler(stage: '8h' | '4h' | '1h'): EventHandler {
    const eventType = `trip.reminder.${stage}`;
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as Record<string, unknown>;
        const recipients = {
          sms: (p.contactPhone as string) ?? undefined,
          whatsapp: (p.contactPhone as string) ?? undefined,
          email: (p.contactEmail as string) ?? undefined,
        };
        if (!recipients.sms && !recipients.email) return;
        const data = journeyData(p, stage !== '8h');
        await this.notifications.notify({
          tenantId: event.tenantId,
          eventId: event.eventId,
          eventType,
          recipients,
          data,
        });
      },
    };
  }

  /**
   * The trip decides its bus and crew by the 4-hour reminder. Choosing or
   * swapping them before that is normal planning (the regular bus is at the
   * mechanic, another runs today): no message — the 4-hour and 1-hour
   * reminders carry whatever the trip has then. A change is announced only
   * when it comes after a passenger was told (a bus breaks down after the
   * 4-hour reminder and another takes its place; a driver is swapped): they
   * are sent the new bus, seats, drivers and crew at once, and the 1-hour
   * reminder repeats them. The same details are never sent twice
   * (journey_details_hash).
   */
  private detailsChangedHandler(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const tenantId = event.tenantId;
        const p = event.payload as { reason?: string; seatMoves?: { to: string }[] };
        const movedTo = (p.seatMoves ?? []).map((m) => m.to);
        const rows = await this.db.query<{
          id: string;
          journey_details_hash: string | null;
          reminded: boolean;
          moved: boolean;
        }>(
          `SELECT b.id, b.journey_details_hash, (b.reminder_4h_sent_at IS NOT NULL) AS reminded,
                  EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.booking_id = b.id AND bs.seat_number = ANY($3::text[])) AS moved
             FROM bookings b JOIN trips t ON t.id = b.trip_id AND t.tenant_id = b.tenant_id
            WHERE b.tenant_id = $1 AND b.trip_id = $2 AND b.status = 'confirmed'
              AND t.status <> 'cancelled' AND t.actual_arrived_at IS NULL`,
          [tenantId, event.aggregateId, movedTo],
          { name: 'notify.detailsChanged.bookings', primary: true, tenantId },
        );
        for (const r of rows) {
          await runInNewContext({ tenantId: tenantId, actorType: 'system' }, async () => {
            // Not told the bus and crew yet: normal planning — the 4-hour
            // reminder will carry the new bus, crew and (moved) seat.
            const told = r.reminded || r.journey_details_hash !== null;
            if (!told) return;
            const details = await this.journeys.boarding(r.id, 'update');
            if (!details || details.detailsHash === r.journey_details_hash) return;
            const changeNote =
              eventType === 'trip.vehicle_changed'
                ? `Your bus has changed${p.reason ? ` (${p.reason})` : ''}.${r.moved ? ' Your seat number has changed too.' : ''}`
                : 'The driver / crew of your bus has changed.';
            const data = { ...journeyData(details, true), changeNote };
            await this.notifications.notify({
              tenantId,
              eventId: event.eventId,
              eventType: 'trip.details_changed',
              recipients: {
                sms: (details.contactPhone as string) ?? undefined,
                whatsapp: (details.contactPhone as string) ?? undefined,
                email: (details.contactEmail as string) ?? undefined,
              },
              data,
            });
            await this.db.execute_(
              `UPDATE bookings SET journey_details_hash = $3 WHERE tenant_id = $1 AND id = $2`,
              [tenantId, r.id, details.detailsHash],
              { name: 'notify.detailsChanged.hash', primary: true, tenantId },
            );
          });
        }
      },
    };
  }

  /**
   * A trip-level event (delay, new departure time, diversion) carries no
   * passenger contact: it goes to the contact of every live booking on the
   * trip (#274, #275). Times are shown in the operator's timezone.
   */
  private tripPassengersHandler(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as {
          delayMinutes?: number;
          reason?: string | null;
          description?: string | null;
          oldDepartsAt?: string;
          newDepartsAt?: string;
        };
        const rows = await this.db.query<{
          pnr: string;
          contact_phone: string | null;
          contact_email: string | null;
          departs_at: Date;
          timezone: string;
        }>(
          `SELECT b.pnr, b.contact_phone, b.contact_email, t.departs_at, te.timezone
             FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN tenants te ON te.id = b.tenant_id
            WHERE b.tenant_id = $1 AND b.trip_id = $2 AND b.status = 'confirmed'`,
          [event.tenantId, event.aggregateId],
          { name: 'notify.tripPassengers', primary: true, tenantId: event.tenantId },
        );
        for (const r of rows) {
          if (!r.contact_phone && !r.contact_email) continue;
          const fmt = (d: Date | string) =>
            new Date(d).toLocaleString('en-IN', {
              timeZone: r.timezone,
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
          const newTime =
            eventType === 'trip.delayed'
              ? fmt(new Date(new Date(r.departs_at).getTime() + (p.delayMinutes ?? 0) * 60_000))
              : fmt(p.newDepartsAt ?? r.departs_at);
          await this.notifications.notify({
            tenantId: event.tenantId,
            eventId: event.eventId,
            eventType,
            recipients: {
              sms: r.contact_phone ?? undefined,
              email: r.contact_email ?? undefined,
            },
            data: {
              pnr: r.pnr,
              delayMinutes: p.delayMinutes,
              newTime,
              oldTime: p.oldDepartsAt ? fmt(p.oldDepartsAt) : undefined,
              reason: p.reason ?? p.description ?? undefined,
            },
          });
        }
      },
    };
  }

  private handlerFor(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const payload = event.payload as Record<string, unknown>;
        // Recipients would be resolved from the booking's contact in production;
        // here we derive from the payload where present.
        const recipients = {
          sms: (payload.contactPhone as string) ?? undefined,
          // A confirmation's email is the e-ticket itself (TicketEmailConsumer),
          // which carries the operator's email template as its opening text.
          email:
            eventType === 'booking.confirmed'
              ? undefined
              : ((payload.contactEmail as string) ?? undefined),
        };
        if (!recipients.sms && !recipients.email) return;

        await this.notifications.notify({
          tenantId: event.tenantId,
          eventId: event.eventId,
          eventType,
          recipients,
          data: {
            pnr: payload.pnr as string,
            refund: payload.refundMinor ? `₹${Number(payload.refundMinor) / 100}` : undefined,
            // The seeded templates say {{refundAmount}}; older ones {{refund}}.
            refundAmount: payload.refundMinor ? `₹${Number(payload.refundMinor) / 100}` : undefined,
            seats: Array.isArray(payload.seats)
              ? (payload.seats as string[]).join(', ')
              : undefined,
            delayMinutes: payload.delayMinutes as number | undefined,
            marginMinutes: payload.marginMinutes as number | undefined,
          },
        });
      },
    };
  }
}

/**
 * A journey payload flattened into the placeholder names the templates use.
 * renderTemplate() looks keys up flat, so `pickup.stopName` is a literal key.
 */
function journeyData(
  p: Record<string, unknown>,
  boarding: boolean,
): Record<string, string | undefined> {
  const passengers = Array.isArray(p.passengers)
    ? (p.passengers as { seat: string; name: string }[])
    : [];
  const data: Record<string, string | undefined> = {
    pnr: p.pnr as string,
    fromStopName: p.fromStopName as string,
    toStopName: p.toStopName as string,
    // Already in the operator's timezone ("30 Sep, 9:30 pm").
    boardingAt: p.boardingAt as string | undefined,
    droppingAt: p.droppingAt as string | undefined,
    passengerNames: passengers.map((x) => `${x.name} (${x.seat})`).join(', '),
    seats: passengers.map((x) => x.seat).join(', '),
  };
  if (!boarding) return data;
  const pickup = (p.pickup as Record<string, unknown>) ?? {};
  const driver = p.driver as { name: string; phone: string | null } | null;
  const attendant = p.attendant as { name: string; phone: string | null } | null;
  return {
    ...data,
    busNumber: (p.busNumber as string) ?? 'TBA',
    'pickup.stopName': pickup.stopName as string,
    'pickup.landmark': (pickup.landmark as string) ?? '',
    'pickup.address': (pickup.address as string) ?? '',
    'driver.name': driver?.name ?? 'Not yet assigned',
    'driver.phone': driver?.phone ?? 'N/A',
    'attendant.name': attendant?.name ?? 'Not yet assigned',
    'attendant.phone': attendant?.phone ?? 'N/A',
    driversList: (p.driversList as string) ?? 'Not yet assigned',
    attendantsList: (p.attendantsList as string) ?? 'Not yet assigned',
    crewList: (p.crewList as string) ?? 'Not yet assigned',
    trackingUrl: (p.trackingUrl as string) ?? '',
    trackingStartsAt: (p.trackingStartsAt as string) ?? '',
  };
}
