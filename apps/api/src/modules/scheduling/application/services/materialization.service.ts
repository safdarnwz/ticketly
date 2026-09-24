import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  addDays, todayIn, localDate, requireTenantId, toInstant,
  type LocalDate, type ServiceId, type TripId, type TimeZone, type SeatLayoutId, type VehicleId
} from '@kernel';
import { DomainError, ErrorCode } from '@kernel';
import { EventBus } from '@messaging';
import { Logger, Metrics } from '@observability';

import { SeatLayoutRepository } from '../../../master-data/infrastructure/persistence/seat-layout.repository';
import { VehicleTypeRepository } from '../../../master-data/infrastructure/persistence/vehicle-type.repository';
import { RouteRepository } from '../../../master-data/infrastructure/persistence/route.repository';
import { FleetService } from '../../../fleet/application/services/fleet.service';
import { datesToMaterialise } from '../../domain/recurrence';
import { ServiceRepository } from '../../infrastructure/persistence/service.repository';
import { TripRepository, type SeatInit, type TripStopRow } from '../../infrastructure/persistence/trip.repository';

/**
 * ============================================================================
 *  Trip materialisation
 * ============================================================================
 *
 * Turns a recurring service into concrete, dated trips over a rolling horizon
 * (default 120 days). Run daily by the worker (Part 9) and on demand when a
 * service is published.
 *
 * For each date the recurrence rule yields that isn't already materialised, it:
 *   1. loads the route path and computes each stop's ABSOLUTE clock time from
 *      the journey date + the service start minute + the origin timezone
 *      (DST-correct via toInstant);
 *   2. snapshots those stops onto the trip (so a later route edit can't rewrite
 *      a sold trip's timetable);
 *   3. initialises one inventory row per bookable seat from the seat layout;
 *   4. (optionally) verifies the default vehicle is road-legal on that date and
 *      leaves the vehicle unassigned if not, so an uninsured bus is never bound.
 *
 * The whole per-date creation is one unit of work — a trip and its full
 * inventory appear atomically or not at all. The unique (service_id,
 * journey_date) constraint makes a concurrent double-run idempotent.
 */
@Injectable()
export class MaterializationService {
  private readonly log: Logger;

  constructor(
    private readonly services: ServiceRepository,
    private readonly routes: RouteRepository,
    private readonly layouts: SeatLayoutRepository,
    private readonly vehicleTypes: VehicleTypeRepository,
    private readonly trips: TripRepository,
    private readonly fleet: FleetService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('Materialization');
  }

  /**
   * Materialise a single service across the horizon. Returns how many trips
   * were created.
   */
  async materialiseService(serviceId: ServiceId, horizonDays?: number): Promise<number> {
    const service = await this.services.getById(serviceId);
    if (service.status !== 'active') return 0;

    const route = await this.routes.getById(service.routeId);
    const vehicleType = await this.vehicleTypes.getById(service.vehicleTypeId);
    if (!vehicleType.seatLayoutId) {
      this.log.warn({ serviceId }, 'vehicle type has no seat layout; skipping materialisation');
      return 0;
    }
    const layout = await this.layouts.getById(vehicleType.seatLayoutId);

    const tz = this.config.domain.timezone;
    const today = todayIn(tz);
    const horizonEnd = addDays(today, horizonDays ?? this.config.domain.inventoryHorizonDays);

    const already = await this.services.materialisedDates(serviceId);
    const dates = datesToMaterialise(service.recurrence, today, horizonEnd, already.map((d) => localDate(d)));

    const seatInit: SeatInit[] = layout.seatMap.toJSON().seats.map((s) => ({
      seatNumber: s.number,
      seatType: s.type,
      isBookable: s.bookable !== false,
      ladiesOnly: s.ladiesOnly === true,
    }));

    let created = 0;
    for (const journeyDate of dates) {
      try {
        await this.materialiseOne(service, route, layout.id, seatInit, journeyDate, tz);
        created += 1;
      } catch (error) {
        // A single bad date must not abort the whole horizon.
        this.log.error(error, 'failed to materialise trip', { serviceId, journeyDate });
      }
    }

    if (created > 0) this.metrics.jobRuns.inc({ job: 'materialisation', outcome: 'ok' });
    this.log.info({ serviceId, created, candidates: dates.length }, 'service materialised');
    return created;
  }

  /** Materialise every active service (the daily job entry point). */
  async materialiseAllActive(horizonDays?: number): Promise<number> {
    const services = await this.services.listActive();
    let total = 0;
    for (const service of services) total += await this.materialiseService(service.id, horizonDays);
    return total;
  }

  private async materialiseOne(
    service: Awaited<ReturnType<ServiceRepository['getById']>>,
    route: Awaited<ReturnType<RouteRepository['getById']>>,
    seatLayoutId: SeatLayoutId,
    seatInit: SeatInit[],
    journeyDate: LocalDate,
    tz: TimeZone,
    extra?: { isExtra: true; reason: string; ladiesSpecial: boolean; closedChannels: string[] },
  ): Promise<TripId> {
    // The origin departure is the one DST-correct anchor: journey date + the
    // service start minute in the origin timezone. Every other stop time is a
    // fixed minute-offset from it (route offsets are relative to service start),
    // so we add milliseconds rather than re-resolving each instant — simpler and
    // free of per-stop wrapping/DST edge bugs.
    const originInstant = toInstant(journeyDate, service.startMinute, tz);
    const stops: TripStopRow[] = route.path.stops.map((s) => {
      const departOffsetMin = s.departDayOffset * 1440 + s.departMinute;
      const arrivalOffsetMin = s.arrivalDayOffset * 1440 + s.arrivalMinute;
      return {
        sequence: s.sequence,
        stopId: s.stopId,
        arrivesAt: new Date(originInstant.getTime() + arrivalOffsetMin * 60_000),
        departsAt: new Date(originInstant.getTime() + departOffsetMin * 60_000),
        canBoard: s.canBoard,
        canAlight: s.canAlight,
      };
    });

    const departsAt = stops[0].departsAt;
    const arrivesAt = stops[stops.length - 1].arrivesAt;

    // Road-legality check for the default vehicle on this journey date.
    let vehicleId = service.defaultVehicleId;
    if (vehicleId && !(await this.fleet.isRoadLegalOn(vehicleId, journeyDate))) {
      this.log.warn({ vehicleId, journeyDate }, 'default vehicle not road-legal on date; leaving unassigned');
      vehicleId = null;
    }
    // Permit-category check, separate from the document-expiry check above —
    // this platform sells individual seats to the public, which a
    // contract-carriage-permitted vehicle can never legally do regardless
    // of whether its permit document is currently valid. See
    // isPermittedForIndividualSale's own doc comment for the full reasoning.
    if (vehicleId && !(await this.fleet.isPermittedForIndividualSale(vehicleId))) {
      this.log.warn({ vehicleId, journeyDate }, 'default vehicle is not permitted for individual-seat sale (contract-carriage or unrecorded permit type); leaving unassigned');
      vehicleId = null;
    }

    return this.uow.run<TripId>({ name: 'trip.materialise', tenantId: requireTenantId() }, async () => {
      const tripId = await this.trips.insertTrip({
        serviceId: service.id,
        routeId: service.routeId,
        vehicleId,
        seatLayoutId,
        journeyDate,
        departsAt,
        arrivesAt,
        stopCount: stops.length,
        stops,
        seats: seatInit,
        extra,
      });
      this.events.publish({
        type: extra ? 'trip.extra_created' : 'trip.materialised',
        aggregateType: 'trip',
        aggregateId: tripId,
        payload: { serviceId: service.id, journeyDate, seats: seatInit.length },
      });
      return tripId;
    });
  }

  /**
   * Create EXTRA (one-off) trips of a service — festival rush, event or
   * ladies specials. Same seat inventory as the service's bus type (never
   * hand-built, so it can't be "incorrect"), optional departure time override,
   * optional bus (must be verified and free), created CLOSED to all channels
   * until the operator releases inventory. A trip of the same route leaving
   * within 30 minutes is reported and needs allowOverlap. One date failing
   * never blocks the others (bulk festival specials).
   */
  async createExtraTrips(input: {
    serviceId: ServiceId; journeyDates: LocalDate[]; departureMinute?: number; vehicleId?: VehicleId | null;
    reason: string; openForSale: boolean; ladiesSpecial: boolean; allowOverlap: boolean;
  }): Promise<{ created: { tripId: TripId; journeyDate: string }[]; skipped: { journeyDate: string; reason: string }[] }> {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 3) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Give a reason for the extra trip (e.g. "Diwali rush")');
    const dates = [...new Set(input.journeyDates)].sort();
    if (dates.length === 0 || dates.length > 31) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Choose 1 to 31 dates');
    if (input.departureMinute !== undefined && !(Number.isInteger(input.departureMinute) && input.departureMinute >= 0 && input.departureMinute < 1440)) {
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Departure time must be between 00:00 and 23:59');
    }
    const service = await this.services.getById(input.serviceId);
    if (service.status !== 'active') throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Extra trips can only be added to an active service');
    const route = await this.routes.getById(service.routeId);
    const vehicleType = await this.vehicleTypes.getById(service.vehicleTypeId);
    if (!vehicleType.seatLayoutId) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'The service bus type has no seat layout');
    const layout = await this.layouts.getById(vehicleType.seatLayoutId);
    const seatInit: SeatInit[] = layout.seatMap.toJSON().seats.map((s) => ({
      seatNumber: s.number, seatType: s.type, isBookable: s.bookable !== false, ladiesOnly: input.ladiesSpecial || s.ladiesOnly === true,
    }));
    const tz = this.config.domain.timezone;
    const today = todayIn(tz);
    const effective = { ...service, startMinute: input.departureMinute ?? service.startMinute, defaultVehicleId: input.vehicleId ?? null };

    const created: { tripId: TripId; journeyDate: string }[] = [];
    const skipped: { journeyDate: string; reason: string }[] = [];
    for (const d of dates) {
      const journeyDate = localDate(d);
      if (journeyDate < today) { skipped.push({ journeyDate: d, reason: 'date is in the past' }); continue; }
      try {
        const departs = toInstant(journeyDate, effective.startMinute, tz);
        if (departs.getTime() <= Date.now()) { skipped.push({ journeyDate: d, reason: 'departure time has already passed' }); continue; }
        if (!input.allowOverlap) {
          const near = await this.trips.tripsNear(service.routeId, departs, 30);
          if (near > 0) { skipped.push({ journeyDate: d, reason: 'another trip on this route leaves within 30 minutes — set allowOverlap to create it anyway' }); continue; }
        }
        const last = route.path.stops[route.path.stops.length - 1];
        const durationMin = last ? last.arrivalDayOffset * 1440 + last.arrivalMinute - (route.path.stops[0].departDayOffset * 1440 + route.path.stops[0].departMinute) : 0;
        if (input.vehicleId && await this.trips.vehicleBusyAround(input.vehicleId, departs, durationMin)) {
          skipped.push({ journeyDate: d, reason: 'the chosen bus is already running another trip at that time' }); continue;
        }
        const tripId = await this.materialiseOne(effective, route, layout.id, seatInit, journeyDate, tz, { isExtra: true, reason, ladiesSpecial: input.ladiesSpecial, closedChannels: input.openForSale ? [] : ['direct_web', 'agent', 'ota', 'phone'] });
        created.push({ tripId, journeyDate: d });
      } catch (e) {
        skipped.push({ journeyDate: d, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    return { created, skipped };
  }
}
