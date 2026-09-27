import { Injectable } from '@nestjs/common';

import {
  ConflictError,
  DomainError,
  ErrorCode,
  NotFoundError,
  type RouteId,
  type ServiceId,
} from '@kernel';

import {
  allocateServiceCode,
  normaliseServiceCode,
  SERVICE_CODE_PATTERN,
  serviceCodeBase,
} from '../../domain/service-code';
import { ServiceRepository } from '../../infrastructure/persistence/service.repository';

/**
 * Names a new service (create or copy). Must run inside the unit of work that
 * inserts it: the code is locked for the transaction, and when a second
 * service joins a time the first one's rename to -A commits with it.
 */
@Injectable()
export class ServiceCodes {
  constructor(private readonly services: ServiceRepository) {}

  /**
   * The operator's own code (upper-cased and checked), or DEL-PAT-1500 built
   * from the route and time, with -A / -B when another service already leaves
   * then (the caller records the rename in that service's history).
   */
  async pick(input: {
    code?: string;
    routeId: RouteId;
    startMinute: number;
  }): Promise<{ code: string; renamed?: { id: ServiceId; from: string; to: string } }> {
    if (input.code?.trim()) {
      const code = normaliseServiceCode(input.code);
      if (!SERVICE_CODE_PATTERN.test(code))
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'A service code has 2–40 letters, digits and single hyphens, like DEL-PAT-1500',
        );
      return { code };
    }
    const picked = await this.allocate(input.routeId, input.startMinute, true);
    if (picked.rename) await this.services.renameCode(picked.rename.id, picked.rename.to);
    return {
      code: picked.code,
      ...(picked.rename
        ? { renamed: { ...picked.rename, id: picked.rename.id as ServiceId } }
        : {}),
    };
  }

  /**
   * What a new service on this route at this time would be called, without
   * creating it: the form shows it before the operator saves.
   */
  async preview(
    routeId: RouteId,
    startMinute: number,
  ): Promise<{ code: string; renames?: { from: string; to: string } }> {
    const picked = await this.allocate(routeId, startMinute, false);
    return {
      code: picked.code,
      ...(picked.rename ? { renames: { from: picked.rename.from, to: picked.rename.to } } : {}),
    };
  }

  private async allocate(routeId: RouteId, startMinute: number, lock: boolean) {
    const cities = await this.services.routeCityCodes(routeId);
    if (!cities) throw new NotFoundError('Route', routeId);
    if (!cities.origin || !cities.dest)
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'The route’s cities have no short codes yet — type a service code',
      );
    const { origin, dest } = cities;
    const base = serviceCodeBase(origin, dest, startMinute);
    if (lock) await this.services.lockCode(base);
    const holders = await this.services.codeHolders(base, {
      originCode: origin,
      destCode: dest,
      startMinute,
    });
    const picked = allocateServiceCode(base, holders);
    if (!picked)
      throw new ConflictError(`26 services already leave as ${base}-A…Z — type a service code`);
    return picked;
  }
}
