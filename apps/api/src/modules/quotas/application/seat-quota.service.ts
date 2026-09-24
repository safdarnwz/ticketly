import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  getUserId,
  requireTenantId,
  type BookingId,
  type TripId,
} from '@kernel';

import { TripRepository } from '../../scheduling/infrastructure/persistence/trip.repository';
import {
  QuotaRuleError,
  quotaReleaseAt,
  validateQuotaAllocation,
  type QuotaHolderType,
} from '../domain/quota-rules';
import { SeatQuotaRepository } from '../infrastructure/seat-quota.repository';

const asAppError = (e: unknown): never => {
  if (e instanceof QuotaRuleError)
    throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
  throw e;
};

@Injectable()
export class SeatQuotaService {
  constructor(
    private readonly quotas: SeatQuotaRepository,
    private readonly trips: TripRepository,
    private readonly uow: UnitOfWork,
  ) {}

  /** Reserve specific seats of a trip for one agent/branch. All-or-nothing. */
  async allocate(
    tripId: TripId,
    input: {
      seatNumbers: string[];
      holderType: QuotaHolderType;
      holderId: string;
      releaseMinutesBefore: number;
    },
  ) {
    const trip = await this.trips.getById(tripId);
    try {
      validateQuotaAllocation({
        seatNumbers: input.seatNumbers,
        releaseMinutesBefore: input.releaseMinutesBefore,
        tripStatus: trip.status,
        departsAt: trip.departsAt,
      });
    } catch (e) {
      asAppError(e);
    }
    const seats = input.seatNumbers.map((s) => s.trim());
    const releaseAt = quotaReleaseAt(trip.departsAt, input.releaseMinutesBefore);

    return this.uow.run({ name: 'quota.allocate', tenantId: requireTenantId() }, async () => {
      const holder = await this.quotas.holderStatus(input.holderType, input.holderId);
      if (!holder)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: `${input.holderType === 'agent' ? 'Agent' : 'Branch'} not found`,
        });
      if (holder !== 'active')
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Seats can only be allocated to an active ${input.holderType} (this one is ${holder})`,
        });
      const { missing, busy } = await this.quotas.lockAndInspect(tripId, seats);
      if (missing.length)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: `No such seat on this trip: ${missing.join(', ')}`,
        });
      if (busy.length)
        throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 409, {
          message: `Already sold, blocked, allocated or being booked: ${busy.join(', ')}`,
        });
      const created = await this.quotas.allocate({
        tripId,
        seats,
        holderType: input.holderType,
        holderId: input.holderId,
        releaseAt,
        createdBy: getUserId() ?? null,
      });
      return { allocated: created, releaseAt: releaseAt.toISOString() };
    });
  }

  list(tripId: TripId, liveOnly = true) {
    return this.quotas.list(tripId, liveOnly);
  }

  /** Operator takes seats back before the automatic release. */
  async release(tripId: TripId, seatNumbers: string[], reason: string) {
    if (!reason?.trim() || reason.trim().length < 5)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Give a short reason for releasing the seats',
      });
    return this.uow.run({ name: 'quota.release', tenantId: requireTenantId() }, async () => {
      const ids = await this.quotas.liveIdsForSeats(
        tripId,
        seatNumbers.map((s) => s.trim()),
      );
      if (ids.length === 0)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: 'None of these seats has a live allocation',
        });
      return {
        released: await this.quotas.close(ids, { kind: 'released', reason: reason.trim() }),
      };
    });
  }

  /**
   * Called INSIDE the holder's booking transaction, just before the hold:
   * frees this holder's quota seats among `seats` so the normal seat-lock gate
   * accepts them. Seats in SOMEONE ELSE's quota stay blocked (the hold then
   * fails as unavailable, as it must). Returns ids consumed.
   */
  async consumeForHolder(
    tripId: TripId,
    seats: string[],
    holderType: QuotaHolderType,
    holderId: string,
    bookingId?: BookingId | null,
  ): Promise<number> {
    const mine = await this.quotas.lockHolderSeats(tripId, seats, holderType, holderId);
    const now = new Date();
    const usable = mine.filter((q) => q.releaseAt > now);
    return this.quotas.close(
      usable.map((q) => q.id),
      { kind: 'consumed', bookingId: bookingId ?? null },
    );
  }

  releaseDue(): Promise<number> {
    return this.quotas.releaseDue();
  }
}
