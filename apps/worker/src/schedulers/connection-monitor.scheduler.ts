import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import { requireTenantId, runInNewContext, type TenantId } from '@kernel';
import { Logger } from '@observability';

/** Minutes of margin below which an at-risk connection is worth warning about, even if not yet technically broken. */
const AT_RISK_MARGIN_MINUTES = 30;

/**
 * Runs periodically (see SchedulerService), checking every ACTIVE
 * connecting journey where leg1 is currently reporting a live delay
 * (trip_live.delay_minutes, the same feed the live-tracking page reads).
 * If the delay has eaten into the layover margin — or wiped it out
 * entirely — the passenger is notified, since NOTHING else in this
 * codebase watches for this: a connecting journey's two legs are booked
 * (and cancelled) independently, but a live delay on leg1 is an event
 * that only makes sense to react to in the context of the CONNECTION, not
 * either booking alone.
 *
 * Deliberately notifies rather than auto-cancelling: a delay easing off,
 * leg2 also running late, or the passenger choosing to make a mad dash for
 * it are all real possibilities this system has no way to rule out — the
 * honest, safe action is to warn early and let the passenger (and support)
 * decide, not to unilaterally cancel a booking that might still be made.
 */
@Injectable()
export class ConnectionMonitorScheduler {
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.forContext('ConnectionMonitorScheduler');
  }

  async run(): Promise<{ checked: number; atRisk: number; broken: number }> {
    const active = await this.uow.run(
      { name: 'connectionMonitor.active', bypassRls: true },
      async (scope) =>
        scope.client.query<{
          id: string;
          leg1_tenant_id: string;
          leg1_booking_id: string;
          leg2_tenant_id: string;
          leg2_booking_id: string;
        }>(
          `SELECT id, leg1_tenant_id, leg1_booking_id, leg2_tenant_id, leg2_booking_id
           FROM journey_connections WHERE status = 'active'`,
        ),
    );

    let atRisk = 0,
      broken = 0;
    for (const link of active.rows) {
      try {
        const result = await this.checkOne(link);
        if (result === 'at_risk') atRisk += 1;
        if (result === 'broken') broken += 1;
      } catch (err) {
        this.log.error(
          { err, connectionId: link.id },
          'connection-risk check failed for this connection — will retry next sweep',
        );
      }
    }
    if (active.rows.length > 0)
      this.log.info(
        { checked: active.rows.length, atRisk, broken },
        'connection-risk sweep complete',
      );
    return { checked: active.rows.length, atRisk, broken };
  }

  private async checkOne(link: {
    id: string;
    leg1_tenant_id: string;
    leg1_booking_id: string;
    leg2_tenant_id: string;
    leg2_booking_id: string;
  }): Promise<'ok' | 'at_risk' | 'broken' | null> {
    const leg1 = await runInNewContext(
      { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
      async () => {
        const booking = await this.db.queryOne<{
          trip_id: string;
          contact_phone: string | null;
          contact_email: string | null;
          pnr: string;
        }>(
          `SELECT trip_id, contact_phone, contact_email, pnr FROM bookings WHERE tenant_id = $1 AND id = $2`,
          [requireTenantId(), link.leg1_booking_id],
          { name: 'connectionMonitor.leg1Booking' },
        );
        if (!booking) return null;
        const trip = await this.db.queryOne<{ arrives_at: Date }>(
          `SELECT arrives_at FROM trips WHERE tenant_id = $1 AND id = $2`,
          [requireTenantId(), booking.trip_id],
          { name: 'connectionMonitor.leg1Trip' },
        );
        const live = await this.db.queryOne<{ delay_minutes: number }>(
          `SELECT delay_minutes FROM trip_live WHERE trip_id = $1`,
          [booking.trip_id],
          { name: 'connectionMonitor.leg1Live' },
        );
        return trip
          ? {
              arrivesAt: trip.arrives_at,
              delayMinutes: live?.delay_minutes ?? 0,
              contactPhone: booking.contact_phone,
              contactEmail: booking.contact_email,
              pnr: booking.pnr,
            }
          : null;
      },
    );
    if (!leg1 || leg1.delayMinutes <= 0) return 'ok'; // no delay reported — nothing to warn about

    const leg2 = await runInNewContext(
      { tenantId: link.leg2_tenant_id as TenantId, actorType: 'system' },
      async () => {
        const booking = await this.db.queryOne<{ trip_id: string }>(
          `SELECT trip_id FROM bookings WHERE tenant_id = $1 AND id = $2`,
          [requireTenantId(), link.leg2_booking_id],
          { name: 'connectionMonitor.leg2Booking' },
        );
        if (!booking) return null;
        const trip = await this.db.queryOne<{ departs_at: Date }>(
          `SELECT departs_at FROM trips WHERE tenant_id = $1 AND id = $2`,
          [requireTenantId(), booking.trip_id],
          { name: 'connectionMonitor.leg2Trip' },
        );
        return trip ? { departsAt: trip.departs_at } : null;
      },
    );
    if (!leg1 || !leg2) return null;

    const projectedArrival = new Date(leg1.arrivesAt.getTime() + leg1.delayMinutes * 60_000);
    const marginMinutes = Math.round(
      (leg2.departsAt.getTime() - projectedArrival.getTime()) / 60_000,
    );

    if (marginMinutes < 0) {
      // The delay has already blown past leg2's departure — this
      // connection is broken, not just at risk. Still notify rather than
      // auto-cancel (see the class doc comment for why), but with the
      // stronger message. tenantId is leg1's — that's whose contact-phone
      // this notification actually reaches the passenger through.
      await this.notifyOnce(link, 'broken', {
        pnr: leg1.pnr,
        contactPhone: leg1.contactPhone,
        contactEmail: leg1.contactEmail,
        delayMinutes: leg1.delayMinutes,
        marginMinutes,
      });
      return 'broken';
    }
    if (marginMinutes < AT_RISK_MARGIN_MINUTES) {
      await this.notifyOnce(link, 'at_risk', {
        pnr: leg1.pnr,
        contactPhone: leg1.contactPhone,
        contactEmail: leg1.contactEmail,
        delayMinutes: leg1.delayMinutes,
        marginMinutes,
      });
      return 'at_risk';
    }
    return 'ok';
  }

  /**
   * Record the alert event and its "sent" marker in ONE transaction (bound to
   * leg1's operator — whose contact channel reaches the passenger). The
   * conditional UPDATE is the once-only guard: a later sweep finds the
   * marker set and sends nothing. publish() must run inside a transaction —
   * outside one it throws, which is why these alerts never went out before.
   */
  private async notifyOnce(
    link: { id: string; leg1_tenant_id: string },
    kind: 'at_risk' | 'broken',
    payload: {
      pnr: string;
      contactPhone: string | null;
      contactEmail: string | null;
      delayMinutes: number;
      marginMinutes: number;
    },
  ): Promise<boolean> {
    const column = kind === 'broken' ? 'broken_notified_at' : 'at_risk_notified_at';
    return this.uow.run(
      { name: `connectionMonitor.notify.${kind}`, tenantId: link.leg1_tenant_id as TenantId },
      async (scope) => {
        const claimed = await scope.client.query(
          `UPDATE journey_connections SET ${column} = now(), updated_at = now() WHERE id = $1 AND ${column} IS NULL RETURNING id`,
          [link.id],
        );
        if (claimed.rowCount === 0) return false; // already alerted
        this.events.publish({
          type: kind === 'broken' ? 'connection.broken' : 'connection.at_risk',
          aggregateType: 'connection',
          aggregateId: link.id,
          tenantId: link.leg1_tenant_id as TenantId,
          payload,
        });
        return true;
      },
    );
  }
}
