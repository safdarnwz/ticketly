import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  DomainError,
  ErrorCode,
  localDate,
  getUserId,
  minuteOfDay,
  requireTenantId,
  type RouteId,
  type ServiceId,
  type StopId,
  type TripId,
} from '@kernel';

import { expandRecurrence, type RecurrenceRule } from '../../domain/recurrence';
import { salesRulesErrors, type ServiceSalesRules } from '../../domain/sales-rules';
import { reservedSeats } from '../../domain/seat-neighbours';
import { MaterializationService } from './materialization.service';
import { ServiceCodes } from './service-codes';
import { ServiceRepository } from '../../infrastructure/persistence/service.repository';
import { TripRepository } from '../../infrastructure/persistence/trip.repository';
import {
  InventoryRepository,
  type SeatAvailability,
} from '../../infrastructure/persistence/inventory.repository';
import { RouteRepository, SeatLayoutRepository } from '../../../master-data';

/** One seat as the passenger's seat map draws it: where it sits and whether it can be booked. */
export interface SeatMapSeat extends SeatAvailability {
  deck: number;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  position: 'front' | 'aisle' | 'window' | null;
  /** A taken seat: the traveller's gender (only that), for "female booked" on the map. */
  bookedGender: 'female' | 'male' | null;
  /** A free seat kept for women or men under the operator's seat-neighbour rule. */
  reservedFor: 'female' | 'male' | null;
}

/**
 * Service lifecycle: create a recurring service, activate it (which triggers an
 * immediate materialisation so trips are bookable right away), pause, and end.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly services: ServiceRepository,
    private readonly routes: RouteRepository,
    private readonly materialization: MaterializationService,
    private readonly uow: UnitOfWork,
    private readonly trips: TripRepository,
    private readonly inventory: InventoryRepository,
    private readonly layouts: SeatLayoutRepository,
    private readonly codes: ServiceCodes,
  ) {}

  /** A trip and its stop timetable, each stop with its name (the passenger picks boarding / dropping from these). */
  async tripDetail(tripId: TripId) {
    const trip = await this.trips.getById(tripId);
    const [stops, names, luggage, serviceCode] = await Promise.all([
      this.trips.loadStops(tripId),
      this.routes.stopsWithNames(trip.routeId),
      this.trips.luggagePolicy(tripId),
      this.trips.serviceCode(tripId),
    ]);
    const byId = new Map(names.map((n) => [n.id, n]));
    return {
      // The trip is "DEL-PAT-1500 on 30 Sep": its service's name and its date.
      trip: { ...trip, serviceCode },
      // Each stop with the operator's per-seat pickup / drop charge there (0 = none).
      stops: stops.map((s) => {
        const ref = byId.get(s.stopId);
        return {
          ...s,
          name: ref?.name ?? null,
          boardChargeMinor: ref?.boardChargeMinor ?? 0,
          dropChargeMinor: ref?.dropChargeMinor ?? 0,
        };
      }),
      /** What the operator lets a passenger carry free, and what more costs (null = not published). */
      luggage,
    };
  }

  /**
   * The seat map for one segment: the bus layout (decks × rows × columns) with
   * every seat placed where it sits, its type and whether it is free on this
   * segment. Seats sold on the trip but not on this segment are free.
   */
  async seatMap(tripId: TripId, fromStopId: StopId, toStopId: StopId) {
    const trip = await this.trips.getById(tripId);
    const seg = await this.inventory.resolveSegment(tripId, fromStopId, toStopId);
    if (!seg)
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Invalid boarding/dropping combination for this trip',
      );
    const [seats, layout, genders, rule] = await Promise.all([
      this.inventory.seatAvailability(tripId, seg.fromSeq, seg.toSeq),
      this.layouts.getById(trip.seatLayoutId),
      this.inventory.seatGenders(tripId, seg.fromSeq, seg.toSeq),
      this.inventory.adjacentSeatRule(),
    ]);
    const map = layout.seatMap.toJSON();
    const cellOf = new Map(map.seats.map((c) => [c.number, c]));
    const placed: SeatMapSeat[] = seats.map((s) => {
      const c = cellOf.get(s.seatNumber);
      return {
        ...s,
        deck: c?.deck ?? 0,
        row: c?.row ?? 0,
        column: c?.column ?? 0,
        rowSpan: c?.rowSpan ?? 1,
        colSpan: c?.colSpan ?? 1,
        position: c?.position ?? null,
        bookedGender: s.available ? null : (genders.get(s.seatNumber) ?? null),
        reservedFor: null,
      };
    });
    const kept = reservedSeats(rule, placed, genders);
    for (const p of placed) if (p.available) p.reservedFor = kept.get(p.seatNumber) ?? null;
    return {
      tripStatus: trip.status,
      seatRule: rule,
      available: placed.filter((s) => s.available).length,
      total: placed.length,
      layout: {
        decks: map.decks,
        rows: map.rows,
        columns: map.columns,
        // Each deck's own grid, and the driver / doors / washroom / stairs —
        // so every screen draws this bus as the operator built it.
        grids: layout.seatMap.grids,
        fixtures: layout.seatMap.fixtures,
      },
      seats: placed,
    };
  }

  async createService(input: {
    code?: string;
    routeId: string;
    vehicleTypeId: string;
    defaultVehicleId?: string;
    startTime: string;
    recurrence: RecurrenceRule;
  }): Promise<{ id: ServiceId; code: string; renamed?: { from: string; to: string } }> {
    // Validate the recurrence rule up front (throws on a bad rule) and confirm
    // the route is published.
    expandRecurrence(input.recurrence, input.recurrence.startDate, input.recurrence.startDate);
    const route = await this.routes.getById(input.routeId as never);
    if (route.status !== 'published') {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Route must be published before a service can run on it',
      );
    }

    const startMinute = minuteOfDay(input.startTime);
    return this.uow.run({ name: 'service.create', tenantId: requireTenantId() }, async () => {
      const { code, renamed } = await this.codes.pick({
        code: input.code,
        routeId: input.routeId as RouteId,
        startMinute,
      });
      const id = await this.services.create({
        code,
        routeId: input.routeId as never,
        vehicleTypeId: input.vehicleTypeId as never,
        defaultVehicleId: input.defaultVehicleId as never,
        startMinute,
        recurrence: input.recurrence,
      });
      await this.services.snapshotVersion(id, `Created as ${code}`, getUserId() ?? null);
      if (renamed) await this.recordRename(renamed, code);
      return { id, code, ...(renamed ? { renamed: { from: renamed.from, to: renamed.to } } : {}) };
    });
  }

  /** The service that had the plain code is now -A: say so in its history. */
  private async recordRename(r: { id: ServiceId; from: string; to: string }, joined: string) {
    await this.services.snapshotVersion(
      r.id,
      `Code ${r.from} → ${r.to}: ${joined} now leaves at the same time`,
      getUserId() ?? null,
    );
  }

  /** OTA release % and women / senior seat quotas of a service (#170, #173, #174). */
  async setSalesRules(serviceId: ServiceId, rules: ServiceSalesRules): Promise<ServiceSalesRules> {
    const errors = salesRulesErrors(rules, await this.services.seatCapacity(serviceId));
    if (errors.length > 0) throw new DomainError(ErrorCode.COMMON_VALIDATION, errors.join('; '));
    await this.services.setSalesRules(serviceId, rules);
    return rules;
  }

  /** Activate and immediately materialise the horizon. */
  async activate(serviceId: ServiceId): Promise<{ trips: number }> {
    await this.uow.run({ name: 'service.activate', tenantId: requireTenantId() }, async () => {
      await this.services.setStatus(serviceId, 'active');
    });
    const trips = await this.materialization.materialiseService(serviceId);
    return { trips };
  }

  async pause(serviceId: ServiceId): Promise<void> {
    await this.uow.run({ name: 'service.pause', tenantId: requireTenantId() }, async () => {
      await this.services.setStatus(serviceId, 'paused');
    });
  }

  async end(serviceId: ServiceId): Promise<void> {
    await this.uow.run({ name: 'service.end', tenantId: requireTenantId() }, async () => {
      await this.services.setStatus(serviceId, 'ended');
    });
  }

  /** Preview which dates a rule would run on, without persisting anything. */
  previewDates(recurrence: RecurrenceRule, from: string, to: string): string[] {
    return expandRecurrence(recurrence, localDate(from), localDate(to));
  }
}
