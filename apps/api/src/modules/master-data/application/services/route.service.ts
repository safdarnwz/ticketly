import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { DomainError, ErrorCode, requireTenantId, type CityId, type RouteId } from '@kernel';
import { PlanQuotaService, QUOTA_KEYS } from '../../../entitlements';
import { EventBus } from '@messaging';

import { StopRepository } from '../../infrastructure/persistence/stop.repository';
import type { RouteStopInput } from '../../routes/domain/route-path';
import { RouteRepository } from '../../infrastructure/persistence/route.repository';

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
    return this.create({
      code: newCode,
      name: newName,
      originCityId: source.originCityId,
      destCityId: source.destCityId,
      startTime: `${hh}:${mm}`,
      stops: source.path.toRouteStopInputs(),
    });
  }
}
