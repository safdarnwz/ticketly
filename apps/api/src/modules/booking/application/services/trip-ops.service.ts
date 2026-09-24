import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  requireTenantId,
  runInNewContext,
  type TenantId,
  type TicketId,
  type TripId,
} from '@kernel';
import { Logger } from '@observability';

import { BookingRepository } from '../../infrastructure/persistence/booking.repository';
import { BookingService } from './booking.service';
import { TripRepository } from '../../../scheduling';

/**
 * Staff-facing trip operations — distinct from BookingService (one
 * passenger's booking) and from CrewAppService (the driver's own
 * start/close-trip + boarding-scan flow). These are the "something happened
 * to the WHOLE TRIP" actions: the bus broke down, weather closed the route,
 * or sales need to pause/resume without touching the trip's status.
 *
 * Lives in the BOOKING module (not scheduling) deliberately: cancelling a
 * trip needs BookingService (to cascade-cancel every passenger's booking,
 * which is what actually triggers each of their refunds) — and
 * scheduling→booking would be the wrong direction (booking already depends
 * on scheduling, not the other way round; adding it there would cycle).
 */
@Injectable()
export class TripOpsService {
  private readonly log: Logger;

  constructor(
    private readonly trips: TripRepository,
    private readonly bookings: BookingRepository,
    private readonly bookingService: BookingService,
    private readonly uow: UnitOfWork,
    logger: Logger,
  ) {
    this.log = logger.forContext('TripOpsService');
  }

  /**
   * Cancel the whole trip — bus breakdown, driver unavailable, route
   * blocked, etc. Cascades to EVERY live booking on it: each one goes
   * through the exact same BookingService.cancel() a customer's own
   * self-cancel uses, so refunds, ledger clawback, and notifications all
   * fire identically — nothing here duplicates or bypasses that logic. One
   * passenger's booking failing to cancel (e.g. a lock conflict) is logged
   * and skipped rather than aborting the whole operation — the trip still
   * gets marked cancelled, and the skipped booking can be retried.
   */
  async cancelTrip(
    tripId: TripId,
    reason: string,
  ): Promise<{ cancelledBookings: number; failed: number }> {
    const trip = await this.trips.getById(tripId);
    if (trip.status === 'cancelled') return { cancelledBookings: 0, failed: 0 }; // idempotent
    if (trip.status === 'departed') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Trip has already departed — cannot cancel',
      });
    }

    const active = await this.bookings.listActiveByTrip(tripId);
    let cancelledBookings = 0,
      failed = 0;
    for (const b of active) {
      try {
        // forceFullRefund: true — this is the OPERATOR cancelling, not the
        // passenger choosing to. The refund-policy page promises a 100%
        // refund for an operator-side cancellation regardless of how close
        // to departure it is; the normal tier-based policy (which exists
        // for VOLUNTARY customer cancellations) must never apply here.
        await this.bookingService.cancel(b.id, `Trip cancelled: ${reason}`, true);
        cancelledBookings += 1;
        await this.cancelLinkedConnectionLeg(b.id, requireTenantId());
      } catch (err) {
        failed += 1;
        this.log.error(
          { err, bookingId: b.id, pnr: b.pnr, tripId },
          'could not cancel booking during trip cancellation — needs manual follow-up',
        );
      }
    }

    await this.trips.setStatus(tripId, 'cancelled');
    this.log.info({ tripId, reason, cancelledBookings, failed }, 'trip cancelled');
    return { cancelledBookings, failed };
  }

  /**
   * If this booking is one leg of an active connecting journey (see
   * ConnectingBookingService/migration 0040), the OTHER leg is now
   * useless to the passenger — they'd have no way to reach the
   * connection city (or, if leg1 was already used and leg2 is the one
   * being force-cancelled, no way to continue onward). Force-cancel it
   * too, with a full refund — this is the OPERATOR's action breaking the
   * journey, not the passenger's choice, on either leg. Best-effort: a
   * failure here is logged, not thrown — the trip-cancellation that
   * triggered this must still complete for every OTHER passenger even if
   * one connecting-leg cleanup fails, and the failure is fully visible in
   * this service's own log for manual follow-up either way.
   */
  private async cancelLinkedConnectionLeg(bookingId: string, tenantId: string): Promise<void> {
    const link = await this.uow.run(
      { name: 'tripOps.findConnection', bypassRls: true },
      async (scope) => {
        const row = await scope.client.query<{
          id: string;
          leg1_tenant_id: string;
          leg1_booking_id: string;
          leg2_tenant_id: string;
          leg2_booking_id: string;
          status: string;
        }>(
          `SELECT id, leg1_tenant_id, leg1_booking_id, leg2_tenant_id, leg2_booking_id, status FROM journey_connections
          WHERE status = 'active' AND ((leg1_tenant_id = $1 AND leg1_booking_id = $2) OR (leg2_tenant_id = $1 AND leg2_booking_id = $2))`,
          [tenantId, bookingId],
        );
        return row.rows[0] ?? null;
      },
    );
    if (!link) return; // not part of any connection — nothing to do

    const isLeg1 = link.leg1_booking_id === bookingId;
    const otherTenantId = isLeg1 ? link.leg2_tenant_id : link.leg1_tenant_id;
    const otherBookingId = isLeg1 ? link.leg2_booking_id : link.leg1_booking_id;

    try {
      await runInNewContext({ tenantId: otherTenantId as TenantId, actorType: 'system' }, () =>
        this.bookingService.cancel(
          otherBookingId as never,
          'Connecting journey broken — the other leg was cancelled by its operator',
          true,
        ),
      );
    } catch (err) {
      this.log.error(
        { err, connectionId: link.id, otherBookingId, otherTenantId },
        'could not auto-cancel the other leg of a broken connection — needs manual follow-up',
      );
      return; // status update below reflects only what actually succeeded
    }

    await this.uow.run({ name: 'tripOps.markConnectionBroken', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE journey_connections SET status = 'both_cancelled', updated_at = now() WHERE id = $1`,
        [link.id],
      );
    });
  }

  /** Stop taking new bookings on this trip without cancelling it or anyone already booked — e.g. the bus is nearly full and the operator wants to hold the last few seats for counter sales. */
  async stopSales(tripId: TripId): Promise<void> {
    const trip = await this.trips.getById(tripId);
    if (trip.status !== 'open')
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: `Trip is '${trip.status}', not 'open' — nothing to stop`,
      });
    await this.trips.setStatus(tripId, 'closed');
  }

  /** Resume selling a trip that had sales stopped (or that a driver accidentally closed) — refuses once the trip has actually departed or was cancelled. */
  async resumeSales(tripId: TripId): Promise<void> {
    const trip = await this.trips.getById(tripId);
    if (trip.status === 'departed' || trip.status === 'cancelled') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: `Trip is '${trip.status}' — sales cannot resume`,
      });
    }
    await this.trips.setStatus(tripId, 'open');
  }

  /**
   * Mark a passenger as a no-show — they never boarded. Distinct from
   * cancelling their booking (refund policy for a no-show is typically far
   * stricter, often zero — that's a separate, deliberate operator decision
   * via the normal cancel/refund flow, not automatic here). This purely
   * records the fact for reporting/CRM (frequent-no-show flagging).
   */
  async markNoShow(ticketId: TicketId): Promise<void> {
    await this.uow.run({ name: 'trip.markNoShow', tenantId: requireTenantId() }, async (scope) => {
      const ticket = (
        await scope.client.query<{ status: string }>(
          `SELECT status FROM tickets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [requireTenantId(), ticketId],
        )
      ).rows[0];
      if (!ticket)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
      if (ticket.status === 'boarded') {
        throw new AppError(ErrorCode.COMMON_CONFLICT, 422, {
          message: 'Passenger already boarded — cannot mark as no-show',
        });
      }
      await scope.client.query(`UPDATE tickets SET status = 'no_show' WHERE id = $1`, [ticketId]);
    });
  }
}
