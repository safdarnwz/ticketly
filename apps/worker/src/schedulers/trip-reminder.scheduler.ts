import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import { runInNewContext, requireTenantId, type Json, type TenantId } from '@kernel';
import { Logger } from '@observability';

import { JourneyDetailsService } from './journey-details.service';

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
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly details: JourneyDetailsService,
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
            ? this.details.trip(ctx.bookingId)
            : this.details.boarding(ctx.bookingId, st.stage),
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
                // The bus / crew / seats the passenger was told, so a later
                // change of any of them is announced once (not repeated).
                const claimed = await scope.client.query(
                  `UPDATE bookings SET ${opts.column} = now(),
                          journey_details_hash = COALESCE($3, journey_details_hash)
                    WHERE tenant_id = $1 AND id = $2 AND ${opts.column} IS NULL RETURNING id`,
                  [requireTenantId(), row.booking_id, (payload.detailsHash as string) ?? null],
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
}
