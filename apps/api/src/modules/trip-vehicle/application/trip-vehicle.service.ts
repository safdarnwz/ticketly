import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError, ErrorCode, getUserId, requireTenantId, type Json, type SeatLayoutId, type TripId, type VehicleId,
} from '@kernel';
import { EventBus } from '@messaging';

import { FleetService } from '../../fleet/application/services/fleet.service';
import { VehicleRepository } from '../../fleet/infrastructure/persistence/vehicle.repository';
import { SeatLayoutRepository } from '../../master-data/infrastructure/persistence/seat-layout.repository';
import { planVehicleSwap, windowsOverlap } from '../domain/vehicle-swap-plan';
import { TripVehicleRepository } from '../infrastructure/trip-vehicle.repository';

/**
 * Change the bus of a scheduled trip. ONE transaction, trip row locked:
 * validate the bus (verified, active, road-legal on the date, not double
 * booked) → if the seat layout differs, re-map every in-use seat (see
 * vehicle-swap-plan.ts) → rebuild trip_seats and move booking seats,
 * passengers, tickets (new boarding codes) and live quotas → audit row →
 * notify re-seated passengers. Anything that doesn't fit → refused, nothing
 * changes.
 */
@Injectable()
export class TripVehicleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly vehicles: VehicleRepository,
    private readonly fleet: FleetService,
    private readonly layouts: SeatLayoutRepository,
    private readonly events: EventBus,
    private readonly repo: TripVehicleRepository,
  ) {}

  async changeVehicle(tripId: TripId, input: { vehicleId: VehicleId; reason: string }): Promise<{
    changed: boolean; layoutChanged: boolean; seatMoves: { from: string; to: string; seatType: string }[]; bookingsAffected: number;
  }> {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 5) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Give a short reason for the bus change (e.g. "breakdown")' });
    const tenantId = requireTenantId();

    return this.uow.run({ name: 'trip.changeVehicle', tenantId }, async () => {
      const trip = await this.repo.lockTrip(tripId);
      if (!trip) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
      if (!['scheduled', 'open'].includes(trip.status)) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `The bus cannot be changed on a ${trip.status} trip` });
      if (trip.departs_at <= new Date()) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'This trip has already departed' });
      if (trip.vehicle_id === input.vehicleId) return { changed: false, layoutChanged: false, seatMoves: [], bookingsAffected: 0 };

      // ── the new bus ──
      const v = await this.vehicles.findById(input.vehicleId);
      if (!v) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Bus not found' });
      if (v.verificationStatus !== 'approved') throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `${v.registrationNo} is not verified by the platform yet` });
      if (v.status !== 'active') throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `${v.registrationNo} is ${v.status}, not active` });
      if (!v.seatLayoutId) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `${v.registrationNo} has no seat layout assigned` });
      if (!(await this.fleet.isRoadLegalOn(v.id, trip.journey_date as never))) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `${v.registrationNo} does not have valid documents for ${trip.journey_date}` });
      }
      const others = await this.repo.otherTripsOfVehicle(v.id, tripId, trip.departs_at, trip.arrives_at);
      const clash = others.find((o) => windowsOverlap({ departsAt: trip.departs_at, arrivesAt: trip.arrives_at }, { departsAt: o.departs_at, arrivesAt: o.arrives_at }));
      if (clash) throw new AppError(ErrorCode.COMMON_CONFLICT, 409, { message: `${v.registrationNo} is already running another trip at that time`, details: { tripId: clash.id } });

      // ── same layout: just the bus changes ──
      const actor = getUserId() ?? null;
      if (v.seatLayoutId === trip.seat_layout_id) {
        await this.repo.setVehicle(tripId, v.id);
        await this.repo.audit({ tripId, from: trip.vehicle_id, to: v.id, fromLayout: trip.seat_layout_id, toLayout: v.seatLayoutId, reason, moves: [], affected: 0, actor });
        this.events.publish({ type: 'trip.vehicle_changed', aggregateType: 'trip', aggregateId: tripId, payload: { registrationNo: v.registrationNo, reason, seatMoves: [] } });
        return { changed: true, layoutChanged: false, seatMoves: [], bookingsAffected: 0 };
      }

      // ── different layout: re-map seats (pure plan, see domain/vehicle-swap-plan.ts) ──
      const layout = await this.layouts.getById(v.seatLayoutId as SeatLayoutId);
      const current = await this.repo.lockSeats(tripId);
      const plan = planVehicleSwap(current, layout.seatMap.toJSON().seats.map((s) => ({ number: s.number, type: s.type, bookable: s.bookable !== false, ladiesOnly: s.ladiesOnly === true })));
      if (plan.blockers.length) {
        throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
          message: `The new bus has no matching seat for: ${plan.blockers.join(', ')}. Choose a bus with enough seats of each type.`,
          details: { blockers: plan.blockers },
        });
      }
      // Customers mid-checkout on a seat that would move: their held booking
      // isn't in the occupancy bitmap yet — refuse rather than strand them.
      if (plan.moves.length) {
        const heldOnMoving = await this.repo.seatsInLiveHolds(tripId, plan.moves.map((m) => m.from));
        if (heldOnMoving.length) {
          throw new AppError(ErrorCode.COMMON_CONFLICT, 409, { message: `Customers are paying for seat(s) ${heldOnMoving.join(', ')} right now — try again in a few minutes`, retryable: true });
        }
      }

      await this.repo.rebuildInventory(tripId, v.id, v.seatLayoutId, plan.newSeats);
      const affected = await this.repo.moveSeats(tripId, plan.moves);
      await this.repo.audit({ tripId, from: trip.vehicle_id, to: v.id, fromLayout: trip.seat_layout_id, toLayout: v.seatLayoutId, reason, moves: plan.moves, affected, actor });
      this.events.publish({
        type: 'trip.vehicle_changed', aggregateType: 'trip', aggregateId: tripId,
        payload: { registrationNo: v.registrationNo, reason, seatMoves: plan.moves as unknown as Json, bookingsAffected: affected },
      });
      return { changed: true, layoutChanged: true, seatMoves: plan.moves, bookingsAffected: affected };
    });
  }

  history(tripId: TripId) {
    return this.repo.history(tripId);
  }
}
