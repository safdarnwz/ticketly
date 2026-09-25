import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, requireTenantId, type TripId } from '@kernel';
import { EventBus } from '@messaging';

import { BookingRepository } from '../../../booking';
import { TripRepository } from '../../../scheduling';

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
    private readonly bookings: BookingRepository,
    private readonly trips: TripRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
  ) {}

  manifest(tripId: TripId): Promise<unknown[]> {
    return this.bookings.manifest(tripId);
  }

  /** Validate a boarding code and mark boarded. Idempotent + anti-forgery. */
  async scanBoarding(
    tripId: TripId,
    boardingCode: string,
  ): Promise<{ status: string; seatNumber: string; passenger?: string }> {
    return this.uow.run({ name: 'crew.scanBoarding', tenantId: requireTenantId() }, async () => {
      const ticket = await this.bookings.lockTicketByBoardingCode(
        boardingCode.trim().toUpperCase(),
      );
      if (!ticket)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Invalid boarding code' });
      if (ticket.tripId !== tripId) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'This ticket is for a different trip',
        });
      }
      if (ticket.bookingStatus !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Booking is not confirmed',
        });
      }
      const passenger = ticket.passengerName ?? undefined;
      // Idempotent: already boarded → return state, don't error.
      if (ticket.status === 'boarded')
        return { status: 'already_boarded', seatNumber: ticket.seatNumber, passenger };
      if (ticket.status === 'cancelled')
        throw new AppError(ErrorCode.COMMON_CONFLICT, 422, { message: 'Ticket is cancelled' });

      await this.bookings.setTicketStatus(ticket.id, 'boarded');
      this.events.publish({
        type: 'passenger.boarded',
        aggregateType: 'ticket',
        aggregateId: ticket.id,
        payload: { tripId, seat: ticket.seatNumber },
      });
      return { status: 'boarded', seatNumber: ticket.seatNumber, passenger };
    });
  }

  async setTripStatus(tripId: TripId, status: 'departed' | 'closed'): Promise<void> {
    await this.uow.run({ name: 'crew.setTripStatus', tenantId: requireTenantId() }, async () => {
      // A doubled tap or a retried request must not re-fire 'trip.departed'.
      const current = await this.trips.getById(tripId);
      if (current.status === status) return;
      if (current.status === 'cancelled')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'This trip was cancelled',
        });
      // Closing is the end of the journey: only a bus that left can arrive.
      if (status === 'closed' && current.status !== 'departed')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Mark the bus departed before closing the trip',
        });
      await this.trips.setStatus(tripId, status);
      if (status === 'departed')
        this.events.publish({
          type: 'trip.departed',
          aggregateType: 'trip',
          aggregateId: tripId,
          payload: {},
        });
    });
  }
}
