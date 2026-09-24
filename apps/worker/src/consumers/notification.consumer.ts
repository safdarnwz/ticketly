import { DatabaseService } from '@database';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type DomainEvent } from '@kernel';

import { NotificationService } from '@api/modules/notification/application/services/notification.service';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

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
  ) {}

  onModuleInit(): void {
    for (const type of ['booking.confirmed', 'booking.cancelled', 'booking.seats_cancelled', 'trip.delayed', 'refund.settled', 'connection.at_risk', 'connection.broken']) {
      this.dispatcher.register(this.handlerFor(type));
    }
    this.dispatcher.register(this.twelveHourReminderHandler());
    this.dispatcher.register(this.waitlistHandler());
    this.dispatcher.register(this.criticalIncidentHandler());
    this.dispatcher.register(this.fourHourReminderHandler());
  }

  /**
   * The two trip-reminder stages carry rich, DIFFERENT payload shapes (see
   * TripReminderScheduler's own doc comment) that the generic handlerFor()
   * below never extracts — it only ever pulls {pnr, refund, seats}. Each
   * gets its own handler that flattens its payload into exactly the
   * placeholder names the seeded templates use. renderTemplate()'s
   * placeholder regex allows dots WITHIN a single key name (it does flat
   * lookup, not nested property access) — so `data['pickup.stopName']` as
   * a literal string key is what makes `{{pickup.stopName}}` in a template
   * resolve, not actual nested-object traversal.
   */
  /** SOS / medical / security / accident → the operator's emergency contacts, immediately. */
  private criticalIncidentHandler(): EventHandler {
    return {
      eventType: 'incident.critical',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const t = await this.db.queryOne<{ contact_phone: string | null; contact_email: string | null }>(
          `SELECT contact_phone, contact_email FROM tenants WHERE id = $1`, [event.tenantId], { name: 'notify.emergencyContacts', primary: true });
        if (!t?.contact_phone && !t?.contact_email) return;
        const p = event.payload as { lat?: number | null; lng?: number | null; type?: string; tripId?: string; description?: string };
        const location = p.lat != null && p.lng != null ? `https://maps.google.com/?q=${p.lat},${p.lng}` : 'not shared';
        await this.notifications.notify({
          tenantId: event.tenantId, eventId: event.eventId, eventType: 'incident.critical',
          recipients: { sms: t.contact_phone ?? undefined, email: t.contact_email ?? undefined },
          data: { type: (p.type ?? 'sos').toUpperCase(), tripId: p.tripId ?? '—', time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), location, description: p.description ?? '' },
        });
      },
    };
  }

  private waitlistHandler(): EventHandler {
    return {
      eventType: 'waitlist.seats_available',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as { contactPhone?: string; contactEmail?: string; seatCount?: number; routeName?: string; journeyDate?: string; bookUrl?: string };
        const recipients = { sms: p.contactPhone ?? undefined, email: p.contactEmail ?? undefined };
        if (!recipients.sms && !recipients.email) return;
        await this.notifications.notify({
          tenantId: event.tenantId, eventId: event.eventId, eventType: 'waitlist.seats_available', recipients,
          data: { seatCount: p.seatCount ?? '', routeName: p.routeName, journeyDate: p.journeyDate, bookUrl: p.bookUrl },
        });
      },
    };
  }

  private twelveHourReminderHandler(): EventHandler {
    return {
      eventType: 'trip.reminder.12h',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as Record<string, unknown>;
        const recipients = { sms: (p.contactPhone as string) ?? undefined, whatsapp: (p.contactPhone as string) ?? undefined, email: (p.contactEmail as string) ?? undefined };
        if (!recipients.sms && !recipients.email) return;
        const passengers = Array.isArray(p.passengers) ? p.passengers as { seat: string; name: string }[] : [];
        await this.notifications.notify({
          tenantId: event.tenantId, eventId: event.eventId, eventType: 'trip.reminder.12h',
          recipients,
          data: {
            pnr: p.pnr as string,
            fromStopName: p.fromStopName as string,
            toStopName: p.toStopName as string,
            boardingAt: p.boardingAt ? new Date(p.boardingAt as string).toLocaleString('en-IN') : undefined,
            droppingAt: p.droppingAt ? new Date(p.droppingAt as string).toLocaleString('en-IN') : undefined,
            passengerNames: passengers.map((x) => `${x.name} (${x.seat})`).join(', '),
          },
        });
      },
    };
  }

  private fourHourReminderHandler(): EventHandler {
    return {
      eventType: 'trip.reminder.4h',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as Record<string, unknown>;
        const recipients = { sms: (p.contactPhone as string) ?? undefined, whatsapp: (p.contactPhone as string) ?? undefined, email: (p.contactEmail as string) ?? undefined };
        if (!recipients.sms && !recipients.email) return;
        const pickup = (p.pickup as Record<string, unknown>) ?? {};
        const driver = p.driver as { name: string; phone: string | null } | null;
        const attendant = p.attendant as { name: string; phone: string | null } | null;
        await this.notifications.notify({
          tenantId: event.tenantId, eventId: event.eventId, eventType: 'trip.reminder.4h',
          recipients,
          data: {
            pnr: p.pnr as string,
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
            trackingUrl: (p.trackingUrl as string) ?? '',
          },
        });
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
          email: (payload.contactEmail as string) ?? undefined,
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
            seats: Array.isArray(payload.seats) ? (payload.seats as string[]).join(', ') : undefined,
            delayMinutes: payload.delayMinutes as number | undefined,
            marginMinutes: payload.marginMinutes as number | undefined,
          },
        });
      },
    };
  }
}
