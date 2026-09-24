import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  DomainError,
  ErrorCode,
  localDate,
  minuteOfDay,
  requireTenantId,
  type ServiceId,
} from '@kernel';

import { expandRecurrence, type RecurrenceRule } from '../../domain/recurrence';
import { MaterializationService } from './materialization.service';
import { ServiceRepository } from '../../infrastructure/persistence/service.repository';
import { RouteRepository } from '../../../master-data/infrastructure/persistence/route.repository';

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
  ) {}

  async createService(input: {
    code: string;
    routeId: string;
    vehicleTypeId: string;
    defaultVehicleId?: string;
    startTime: string;
    recurrence: RecurrenceRule;
  }): Promise<ServiceId> {
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

    return this.uow.run({ name: 'service.create', tenantId: requireTenantId() }, async () =>
      this.services.create({
        code: input.code,
        routeId: input.routeId as never,
        vehicleTypeId: input.vehicleTypeId as never,
        defaultVehicleId: input.defaultVehicleId as never,
        startMinute: minuteOfDay(input.startTime),
        recurrence: input.recurrence,
      }),
    );
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
