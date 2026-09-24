import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import { type TenantId } from '@kernel';
import { Logger } from '@observability';

import { JourneyConnectionRepository, type JourneyConnection } from '@api/modules/booking';

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
    private readonly connections: JourneyConnectionRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.forContext('ConnectionMonitorScheduler');
  }

  async run(): Promise<{ checked: number; atRisk: number; broken: number }> {
    const active = await this.connections.listActive();
    let atRisk = 0,
      broken = 0;
    for (const link of active) {
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
    if (active.length > 0)
      this.log.info({ checked: active.length, atRisk, broken }, 'connection-risk sweep complete');
    return { checked: active.length, atRisk, broken };
  }

  private async checkOne(link: JourneyConnection): Promise<'ok' | 'at_risk' | 'broken' | null> {
    const t = await this.connections.timing(link.id);
    if (!t) return null;
    if (t.leg1DelayMinutes <= 0) return 'ok'; // no delay reported — nothing to warn about

    const projectedArrival = new Date(t.leg1ArrivesAt.getTime() + t.leg1DelayMinutes * 60_000);
    const marginMinutes = Math.round(
      (t.leg2DepartsAt.getTime() - projectedArrival.getTime()) / 60_000,
    );
    // Below zero the delay has already blown past leg 2's departure: broken,
    // not just at risk. Still a warning, never an auto-cancel (see above).
    const kind =
      marginMinutes < 0 ? 'broken' : marginMinutes < AT_RISK_MARGIN_MINUTES ? 'at_risk' : null;
    if (!kind) return 'ok';
    await this.notifyOnce(link, kind, {
      pnr: t.pnr,
      contactPhone: t.contactPhone,
      contactEmail: t.contactEmail,
      delayMinutes: t.leg1DelayMinutes,
      marginMinutes,
    });
    return kind;
  }

  /**
   * Record the alert event and its "sent" marker in ONE transaction (bound to
   * leg1's operator — whose contact channel reaches the passenger). The
   * conditional UPDATE is the once-only guard: a later sweep finds the
   * marker set and sends nothing. publish() must run inside a transaction —
   * outside one it throws, which is why these alerts never went out before.
   */
  private async notifyOnce(
    link: JourneyConnection,
    kind: 'at_risk' | 'broken',
    payload: {
      pnr: string;
      contactPhone: string | null;
      contactEmail: string | null;
      delayMinutes: number;
      marginMinutes: number;
    },
  ): Promise<boolean> {
    return this.uow.run(
      { name: `connectionMonitor.notify.${kind}`, tenantId: link.leg1TenantId as TenantId },
      async () => {
        // Joins this transaction, so the marker and the event commit together.
        if (!(await this.connections.claimAlert(link.id, kind))) return false; // already alerted
        this.events.publish({
          type: kind === 'broken' ? 'connection.broken' : 'connection.at_risk',
          aggregateType: 'connection',
          aggregateId: link.id,
          tenantId: link.leg1TenantId as TenantId,
          payload,
        });
        return true;
      },
    );
  }
}
