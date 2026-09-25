import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type Json,
  type RouteId,
  type ServiceId,
  type VehicleId,
  type VehicleTypeId,
} from '@kernel';

import type { RecurrenceRule } from '../../domain/recurrence';
import type { ServiceSalesRules } from '../../domain/sales-rules';

registerConstraintMessages({
  services_tenant_id_code_key: 'A service with this code already exists',
});

export type ServiceStatus = 'draft' | 'active' | 'paused' | 'ended';

export interface ServiceRecord {
  id: ServiceId;
  code: string;
  routeId: RouteId;
  vehicleTypeId: VehicleTypeId;
  defaultVehicleId: VehicleId | null;
  startMinute: number;
  recurrence: RecurrenceRule;
  status: ServiceStatus;
}

@Injectable()
export class ServiceRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    code: string;
    routeId: RouteId;
    vehicleTypeId: VehicleTypeId;
    defaultVehicleId?: VehicleId;
    startMinute: number;
    recurrence: RecurrenceRule;
  }): Promise<ServiceId> {
    const id = newId() as ServiceId;
    await this.db.execute_(
      `INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        requireTenantId(),
        input.code.trim(),
        input.routeId,
        input.vehicleTypeId,
        input.defaultVehicleId ?? null,
        input.startMinute,
        JSON.stringify(input.recurrence),
      ],
      { name: 'service.create', primary: true },
    );
    return id;
  }

  async getById(id: ServiceId): Promise<ServiceRecord> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence, status
         FROM services WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'service.getById', primary: true },
    );
    if (!row) throw new NotFoundError('Service', id);
    return map(row);
  }

  async salesRules(id: ServiceId): Promise<ServiceSalesRules> {
    const row = await this.db.queryOne<{ sales_rules: ServiceSalesRules }>(
      `SELECT sales_rules FROM services WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'service.salesRules' },
    );
    if (!row) throw new NotFoundError('Service', id);
    return row.sales_rules;
  }

  async setSalesRules(id: ServiceId, rules: ServiceSalesRules): Promise<void> {
    const n = await this.db.execute_(
      `UPDATE services SET sales_rules = $3, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, JSON.stringify(rules)],
      { name: 'service.setSalesRules', primary: true },
    );
    if (n === 0) throw new NotFoundError('Service', id);
  }

  async setStatus(id: ServiceId, status: ServiceStatus): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE services SET status = $3, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, status],
      { name: 'service.setStatus', primary: true },
    );
    if (affected === 0) throw new NotFoundError('Service', id);
  }

  async listActive(): Promise<ServiceRecord[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence, status
         FROM services WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [requireTenantId()],
      { name: 'service.listActive', primary: true },
    );
    return rows.map(map);
  }

  /** Every service regardless of status — for the management console (listActive() is search-only). */
  async listAll(): Promise<ServiceRecord[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence, status
         FROM services WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [requireTenantId()],
      { name: 'service.listAll', primary: true },
    );
    return rows.map(map);
  }

  /** Journey dates already materialised for a service (to compute the delta). */
  async materialisedDates(serviceId: ServiceId): Promise<string[]> {
    const rows = await this.db.query<{ journey_date: string }>(
      // Regular trips only: an EXTRA trip on a date must never stop that
      // date's regular trip from being materialised.
      `SELECT journey_date FROM trips WHERE service_id = $1 AND NOT is_extra`,
      [serviceId],
      { name: 'service.materialisedDates', primary: true },
    );
    return rows.map((r) => r.journey_date);
  }
}

interface Row {
  id: ServiceId;
  code: string;
  route_id: RouteId;
  vehicle_type_id: VehicleTypeId;
  default_vehicle_id: VehicleId | null;
  start_minute: number;
  recurrence: Json;
  status: ServiceStatus;
}
function map(r: Row): ServiceRecord {
  return {
    id: r.id,
    code: r.code,
    routeId: r.route_id,
    vehicleTypeId: r.vehicle_type_id,
    defaultVehicleId: r.default_vehicle_id,
    startMinute: r.start_minute,
    recurrence: r.recurrence as unknown as RecurrenceRule,
    status: r.status,
  };
}
