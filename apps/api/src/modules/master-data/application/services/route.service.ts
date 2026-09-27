import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  DomainError,
  ErrorCode,
  requireTenantId,
  type CityId,
  type RouteId,
  type StopId,
} from '@kernel';
import { PlanQuotaService, QUOTA_KEYS } from '../../../entitlements';
import { EventBus } from '@messaging';

import { StopRepository } from '../../infrastructure/persistence/stop.repository';
import type { RouteStopInput } from '../../routes/domain/route-path';
import {
  RouteRepository,
  type PointCharge,
} from '../../infrastructure/persistence/route.repository';

/**
 * Route lifecycle service.
 *
 * Creation is a unit of work that validates the FULL path (via RoutePath) and
 * checks that every referenced stop exists and belongs to this operator BEFORE
 * writing anything — so a route can never be half-created or reference a
 * phantom stop. Publishing emits `route.published`, which scheduling (Part 5)
 * consumes to allow services on the route.
 */
@Injectable()
export class RouteService {
  constructor(
    private readonly routes: RouteRepository,
    private readonly stops: StopRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly planQuotas: PlanQuotaService,
  ) {}

  async create(input: {
    code: string;
    name: string;
    originCityId: CityId;
    destCityId: CityId;
    startTime: string;
    stops: RouteStopInput[];
  }): Promise<RouteId> {
    await this.planQuotas.assertCanAdd(
      QUOTA_KEYS.routes,
      await this.routes.countActive(),
      'routes',
    );
    // Referential check: all stops exist for this tenant.
    await this.stops.assertExist(input.stops.map((s) => s.stopId));

    // Origin/destination cities must match the first/last stop's city.
    if (input.stops.length < 2) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'A route needs at least an origin and destination stop',
      );
    }

    return this.uow.run({ name: 'route.create', tenantId: requireTenantId() }, async () =>
      this.routes.create(input),
    );
  }

  async publish(id: RouteId): Promise<void> {
    await this.uow.run({ name: 'route.publish', tenantId: requireTenantId() }, async () => {
      const route = await this.routes.getById(id);
      if (route.path.stops.length < 2) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'Cannot publish a route with fewer than 2 stops',
        );
      }
      await this.routes.setStatus(id, 'published');
      this.events.publish({
        type: 'route.published',
        aggregateType: 'route',
        aggregateId: id,
        payload: { code: route.code, segments: route.path.segments().length },
      });
    });
  }

  async archive(id: RouteId): Promise<void> {
    await this.uow.run({ name: 'route.archive', tenantId: requireTenantId() }, async () => {
      await this.routes.setStatus(id, 'archived');
    });
  }

  /** Duplicate a route — same stops/timing/cities, a fresh code, always starts as a 'draft' regardless of the source's status (a published route being copied is presumably about to be tweaked, not published verbatim). */
  async duplicate(id: RouteId, newCode: string, newName: string): Promise<RouteId> {
    const source = await this.routes.getById(id);
    const startMinute = source.path.originStartMinute;
    const hh = String(Math.floor(startMinute / 60)).padStart(2, '0');
    const mm = String(startMinute % 60).padStart(2, '0');
    const copy = await this.create({
      code: newCode,
      name: newName,
      originCityId: source.originCityId,
      destCityId: source.destCityId,
      startTime: `${hh}:${mm}`,
      stops: source.path.toRouteStopInputs(),
    });
    await this.uow.run({ name: 'route.duplicateCharges', tenantId: requireTenantId() }, () =>
      this.routes.copyPointCharges(id, copy),
    );
    return copy;
  }

  /** The route's stops with their pickup / drop charges (404 for another operator's route). */
  async pointCharges(id: RouteId): Promise<PointCharge[]> {
    await this.routes.getById(id);
    return this.routes.pointCharges(id);
  }

  /**
   * Set pickup / drop charges (per seat, paise) for some stops of a route.
   * Refused: an archived route, a stop not on the route, a stop named twice, a
   * boarding charge where nobody can board (incl. the last stop) or a drop
   * charge where nobody can get off (incl. the first stop).
   */
  async setPointCharges(
    id: RouteId,
    items: { stopId: StopId; boardChargeMinor: number; dropChargeMinor: number }[],
  ): Promise<PointCharge[]> {
    const route = await this.routes.getById(id);
    if (route.status === 'archived') {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'This route is archived — its charges cannot change',
      );
    }
    const stops = await this.routes.pointCharges(id);
    const byId = new Map(stops.map((s) => [s.stopId, s]));
    const first = stops[0]?.sequence;
    const last = stops[stops.length - 1]?.sequence;
    const seen = new Set<string>();
    for (const item of items) {
      const stop = byId.get(item.stopId);
      if (!stop)
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'A stop in the list is not on this route',
        );
      if (seen.has(item.stopId)) {
        throw new DomainError(ErrorCode.COMMON_VALIDATION, `${stop.name} is listed twice`);
      }
      seen.add(item.stopId);
      if (item.boardChargeMinor > 0 && (!stop.canBoard || stop.sequence === last)) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          `Passengers cannot board at ${stop.name}`,
        );
      }
      if (item.dropChargeMinor > 0 && (!stop.canAlight || stop.sequence === first)) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          `Passengers cannot get off at ${stop.name}`,
        );
      }
    }
    await this.uow.run({ name: 'route.setPointCharges', tenantId: requireTenantId() }, () =>
      this.routes.setPointCharges(id, items),
    );
    return this.routes.pointCharges(id);
  }
}
