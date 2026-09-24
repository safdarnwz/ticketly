import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { AppError, ErrorCode, requireTenantId, type TripId } from '@kernel';
import { EventBus } from '@messaging';

/**
 * Crew/driver app backend.
 *
 *  - **manifest** — the passenger list for a trip (seat, name, boarding/dropping
 *    points), read by the conductor at each stop.
 *  - **boarding scan** — validate a ticket's boarding code and mark the
 *    passenger boarded. Idempotent: scanning an already-boarded ticket returns
 *    its state rather than erroring, and a ticket for a different trip or a
 *    cancelled booking is rejected — the guard against a forged or reused QR.
 *  - **trip start/stop** — the driver flips the trip's operational status,
 *    which feeds live tracking.
 */
@Injectable()
export class CrewAppService {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
  ) {}

  async manifest(tripId: TripId): Promise<unknown[]> {
    return this.db.query(
      `SELECT p.seat_number AS "seatNumber", p.full_name AS "fullName", p.age, p.gender,
              b.pnr, b.from_stop_id AS "fromStopId", b.to_stop_id AS "toStopId",
              t.status AS "ticketStatus"
         FROM passengers p
         JOIN bookings b ON b.id = p.booking_id AND b.status = 'confirmed'
         LEFT JOIN tickets t ON t.booking_id = b.id AND t.seat_number = p.seat_number
        WHERE p.tenant_id = $1 AND b.trip_id = $2
        ORDER BY p.seat_number`,
      [requireTenantId(), tripId],
      { name: 'crew.manifest' },
    );
  }

  /** Validate a boarding code and mark boarded. Idempotent + anti-forgery. */
  async scanBoarding(tripId: TripId, boardingCode: string): Promise<{ status: string; seatNumber: string; passenger?: string }> {
    return this.uow.run({ name: 'crew.scanBoarding', tenantId: requireTenantId() }, async (scope) => {
      const ticket = (await scope.client.query<{ id: string; trip_id: string; seat_number: string; status: string; booking_status: string; full_name: string | null }>(
        `SELECT tk.id, tk.trip_id, tk.seat_number, tk.status,
                b.status AS booking_status,
                p.full_name
           FROM tickets tk
           JOIN bookings b ON b.id = tk.booking_id
           LEFT JOIN passengers p ON p.booking_id = b.id AND p.seat_number = tk.seat_number
          WHERE tk.tenant_id = $1 AND tk.boarding_code = $2
          FOR UPDATE OF tk`,
        [requireTenantId(), boardingCode.trim().toUpperCase()],
      )).rows[0];

      if (!ticket) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Invalid boarding code' });
      if (ticket.trip_id !== tripId) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'This ticket is for a different trip' });
      }
      if (ticket.booking_status !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: 'Booking is not confirmed' });
      }
      if (ticket.status === 'boarded') {
        // Idempotent: already boarded → return state, don't error.
        return { status: 'already_boarded', seatNumber: ticket.seat_number, passenger: ticket.full_name ?? undefined };
      }
      if (ticket.status === 'cancelled') {
        throw new AppError(ErrorCode.COMMON_CONFLICT, 422, { message: 'Ticket is cancelled' });
      }

      await scope.client.query(
        `UPDATE tickets SET status = 'boarded', boarded_at = now() WHERE id = $1`,
        [ticket.id],
      );
      this.events.publish({
        type: 'passenger.boarded',
        aggregateType: 'ticket',
        aggregateId: ticket.id,
        payload: { tripId, seat: ticket.seat_number },
      });
      return { status: 'boarded', seatNumber: ticket.seat_number, passenger: ticket.full_name ?? undefined };
    });
  }

  async setTripStatus(tripId: TripId, status: 'departed' | 'closed'): Promise<void> {
    await this.uow.run({ name: 'crew.setTripStatus', tenantId: requireTenantId() }, async (scope) => {
      // Guard against re-firing 'trip.departed' on a trip that's already
      // departed (e.g. a doubled crew-app tap, or a retried request) — no
      // consumer currently reacts to this event, but that's exactly why a
      // silent double-publish here would be easy to miss until one is
      // added and assumes "fires once per trip", same as any other status
      // transition in this codebase.
      const current = (await scope.client.query<{ status: string }>(
        `SELECT status FROM trips WHERE tenant_id = $1 AND id = $2`,
        [requireTenantId(), tripId],
      )).rows[0];
      if (!current) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
      if (current.status === status) return; // already in this state — no-op

      await scope.client.query(
        `UPDATE trips SET status = $3, updated_at = now(),
                actual_departed_at = CASE WHEN $3 = 'departed' THEN coalesce(actual_departed_at, now()) ELSE actual_departed_at END,
                actual_arrived_at = CASE WHEN $3 = 'closed' THEN coalesce(actual_arrived_at, now()) ELSE actual_arrived_at END
          WHERE tenant_id = $1 AND id = $2`,
        [requireTenantId(), tripId, status],
      );
      if (status === 'departed') {
        this.events.publish({ type: 'trip.departed', aggregateType: 'trip', aggregateId: tripId, payload: {} });
      }
    });
  }
}
