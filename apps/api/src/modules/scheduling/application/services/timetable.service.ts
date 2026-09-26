import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  getUserId,
  minuteOfDay,
  requireTenantId,
  type RouteId,
  type ServiceId,
  type TripId,
  type VehicleId,
  type VehicleTypeId,
  todayIn,
} from '@kernel';
import { EventBus } from '@messaging';

import { expandRecurrence, type RecurrenceRule } from '../../domain/recurrence';
import { RouteBlackoutRepository } from '../../infrastructure/persistence/route-blackout.repository';
import { ServiceRepository } from '../../infrastructure/persistence/service.repository';
import { TripRepository } from '../../infrastructure/persistence/trip.repository';

/** A trip is moved at most this far in one go; beyond that, cancel and run an extra trip. */
const MAX_SHIFT_MINUTES = 12 * 60;

/**
 * Timetable management of services and trips:
 *  - edit a service's timetable, every change kept as a version (#269) that
 *    can be restored (#270). Changes apply to trips materialised from now on;
 *    a trip already on sale is moved with `retimeTrip`;
 *  - clone a service for new dates (#266) or as a seasonal variant (#272);
 *  - permanently delete a service that never ran or sold (#169);
 *  - move one trip, telling every passenger (#275);
 *  - route blackout dates (#271).
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly services: ServiceRepository,
    private readonly trips: TripRepository,
    private readonly blackouts: RouteBlackoutRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly config: AppConfig,
  ) {}

  async updateTimetable(
    id: ServiceId,
    patch: {
      startTime?: string;
      recurrence?: RecurrenceRule;
      vehicleTypeId?: string;
      defaultVehicleId?: string | null;
      note?: string;
    },
  ) {
    const current = await this.services.getById(id);
    if (current.status === 'ended') throw validation('This service has ended — clone it instead');
    if (patch.recurrence) {
      validateRule(patch.recurrence);
      if (patch.recurrence.endDate < this.today())
        throw validation('The service would already have ended — pick an end date from today on');
    }
    return this.uow.run(
      { name: 'service.updateTimetable', tenantId: requireTenantId() },
      async () => {
        await this.services.updateTimetable(id, {
          startMinute: patch.startTime ? minuteOfDay(patch.startTime) : undefined,
          recurrence: patch.recurrence,
          vehicleTypeId: patch.vehicleTypeId as VehicleTypeId | undefined,
          defaultVehicleId: patch.defaultVehicleId as VehicleId | null | undefined,
        });
        const version = await this.services.snapshotVersion(
          id,
          patch.note?.trim() || 'Timetable edited',
          getUserId() ?? null,
        );
        return { version };
      },
    );
  }

  private today(): string {
    return todayIn(this.config.domain.timezone);
  }

  listVersions(id: ServiceId) {
    return this.services.listVersions(id);
  }

  /** Restore an earlier version — recorded as a new version, history is never rewritten. */
  async restoreVersion(id: ServiceId, versionNumber: number) {
    const v = await this.services.getVersion(id, versionNumber);
    if (!v) throw new NotFoundError('Service version', String(versionNumber));
    if (v.snapshot.recurrence.endDate < this.today())
      throw validation('That version ended in the past — restoring it would stop the service');
    return this.uow.run(
      { name: 'service.restoreVersion', tenantId: requireTenantId() },
      async () => {
        await this.services.updateTimetable(id, {
          startMinute: v.snapshot.startMinute,
          recurrence: v.snapshot.recurrence,
          vehicleTypeId: v.snapshot.vehicleTypeId,
          defaultVehicleId: v.snapshot.defaultVehicleId,
        });
        const version = await this.services.snapshotVersion(
          id,
          `Restored from version ${versionNumber}`,
          getUserId() ?? null,
        );
        return { version };
      },
    );
  }

  /**
   * Copy a service to run on other dates (a draft to activate). As a
   * seasonal variant (`season: true`), the dates it covers become exceptions
   * of the original, so the two never run on the same day.
   */
  async clone(
    sourceId: ServiceId,
    input: {
      code: string;
      startDate: string;
      endDate: string;
      startTime?: string;
      weekdays?: number[];
      season?: boolean;
    },
  ): Promise<{ id: ServiceId }> {
    const source = await this.services.getById(sourceId);
    if (input.startDate < this.today()) throw validation('A copy cannot start in the past');
    const recurrence: RecurrenceRule = {
      ...source.recurrence,
      ...(input.weekdays ? { frequency: 'weekly' as const, weekdays: input.weekdays } : {}),
      startDate: input.startDate as RecurrenceRule['startDate'],
      endDate: input.endDate as RecurrenceRule['endDate'],
      exceptions: [],
      additions: [],
    };
    validateRule(recurrence);
    return this.uow.run({ name: 'service.clone', tenantId: requireTenantId() }, async () => {
      const id = await this.services.clone(sourceId, {
        code: input.code,
        startMinute: input.startTime ? minuteOfDay(input.startTime) : source.startMinute,
        recurrence,
      });
      await this.services.snapshotVersion(id, `Cloned from ${source.code}`, getUserId() ?? null);
      if (input.season) {
        const seasonDates = expandRecurrence(
          recurrence,
          recurrence.startDate,
          recurrence.endDate,
          366,
        );
        const exceptions = [
          ...new Set([...(source.recurrence.exceptions ?? []), ...seasonDates]),
        ].sort();
        await this.services.updateTimetable(sourceId, {
          recurrence: { ...source.recurrence, exceptions },
        });
        await this.services.snapshotVersion(
          sourceId,
          `Season ${input.code} (${input.startDate} – ${input.endDate}) runs instead`,
          getUserId() ?? null,
        );
      }
      return { id };
    });
  }

  /**
   * Delete a service for good, with its trips. Only one that never sold or
   * ran: bookings, run trips and expenses are history that must be kept (end
   * the service instead).
   */
  async deleteService(id: ServiceId): Promise<{ tripsDeleted: number }> {
    return this.uow.run({ name: 'service.delete', tenantId: requireTenantId() }, async () => {
      await this.services.getById(id);
      const b = await this.services.deletionBlockers(id);
      if (b.bookedTrips + b.ranTrips + b.tripsWithExpenses > 0)
        throw new ConflictError(
          `This service has history (${b.bookedTrips} trip(s) with bookings, ${b.ranTrips} run, ${b.tripsWithExpenses} with expenses) — end it instead of deleting it`,
        );
      return { tripsDeleted: await this.services.hardDelete(id) };
    });
  }

  /** Move one trip to a new departure time and tell its passengers (#275). */
  async retimeTrip(tripId: TripId, input: { newDepartsAt: string; reason: string }) {
    const trip = await this.trips.getById(tripId);
    const target = new Date(input.newDepartsAt);
    if (target.getTime() <= Date.now()) throw validation('The new departure must be in the future');
    const minutes = Math.round((target.getTime() - trip.departsAt.getTime()) / 60_000);
    if (minutes === 0) throw validation('That is the current departure time');
    if (Math.abs(minutes) > MAX_SHIFT_MINUTES)
      throw validation(
        `A trip moves by at most ${MAX_SHIFT_MINUTES / 60} hours — cancel it and add an extra trip instead`,
      );
    return this.uow.run({ name: 'trip.retime', tenantId: requireTenantId() }, async () => {
      const moved = await this.trips.shiftTimes(tripId, minutes);
      if (!moved) throw new ConflictError('Only a trip that has not left can be re-timed');
      this.events.publish({
        type: 'trip.retimed',
        aggregateType: 'trip',
        aggregateId: tripId,
        payload: {
          oldDepartsAt: moved.oldDepartsAt.toISOString(),
          newDepartsAt: moved.newDepartsAt.toISOString(),
          shiftMinutes: minutes,
          reason: input.reason,
        },
      });
      return {
        oldDepartsAt: moved.oldDepartsAt.toISOString(),
        newDepartsAt: moved.newDepartsAt.toISOString(),
        shiftMinutes: minutes,
      };
    });
  }

  /**
   * Stop a route running on some dates (#271): future materialisation skips
   * them, trips nobody booked are cancelled now, and trips with bookings are
   * listed for the operator to cancel (refunds) or keep.
   */
  async addBlackout(routeId: RouteId, dates: string[], reason: string) {
    const past = dates.filter((d) => d < this.today());
    if (past.length) throw validation(`These dates have passed: ${past.join(', ')}`);
    return this.uow.run({ name: 'route.blackout', tenantId: requireTenantId() }, async () => {
      await this.blackouts.add(routeId, dates, reason, getUserId() ?? null);
      const trips = await this.trips.tripsOnDates(routeId, dates);
      const cancelled = await this.trips.cancelUnbooked(
        trips.filter((t) => t.bookings === 0).map((t) => t.tripId),
      );
      return {
        dates,
        tripsCancelled: cancelled,
        tripsWithBookings: trips.filter((t) => t.bookings > 0),
      };
    });
  }

  async removeBlackout(routeId: RouteId, dates: string[]) {
    return { removed: await this.blackouts.remove(routeId, dates) };
  }

  listBlackouts(routeId: RouteId) {
    return this.blackouts.list(routeId);
  }
}

function validateRule(rule: RecurrenceRule): void {
  // Throws a 422 DomainError on a bad rule.
  expandRecurrence(rule, rule.startDate, rule.startDate);
}

function validation(message: string): AppError {
  return new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });
}
