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

export interface ServiceVersion {
  versionNumber: number;
  snapshot: {
    startMinute: number;
    recurrence: RecurrenceRule;
    vehicleTypeId: VehicleTypeId;
    defaultVehicleId: VehicleId | null;
  };
  note: string;
  createdBy: string | null;
  createdAt: Date;
}

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

  /** Seats on the service's bus type (its seat layout). */
  async seatCapacity(id: ServiceId): Promise<number | null> {
    const row = await this.db.queryOne<{ seats: number | null }>(
      `SELECT sl.total_seats::int AS seats
         FROM services s JOIN vehicle_types vt ON vt.id = s.vehicle_type_id
         LEFT JOIN seat_layouts sl ON sl.id = vt.seat_layout_id
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [requireTenantId(), id],
      { name: 'service.seatCapacity' },
    );
    return row?.seats ?? null;
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

  /** Change a service's timetable fields (#269). Only what is given changes. */
  async updateTimetable(
    id: ServiceId,
    patch: {
      startMinute?: number;
      recurrence?: RecurrenceRule;
      vehicleTypeId?: VehicleTypeId;
      defaultVehicleId?: VehicleId | null;
    },
  ): Promise<void> {
    const n = await this.db.execute_(
      `UPDATE services SET
         start_minute = coalesce($3, start_minute),
         recurrence = coalesce($4::jsonb, recurrence),
         vehicle_type_id = coalesce($5, vehicle_type_id),
         default_vehicle_id = CASE WHEN $6::boolean THEN $7::uuid ELSE default_vehicle_id END,
         version = version + 1, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        requireTenantId(),
        id,
        patch.startMinute ?? null,
        patch.recurrence ? JSON.stringify(patch.recurrence) : null,
        patch.vehicleTypeId ?? null,
        patch.defaultVehicleId !== undefined,
        patch.defaultVehicleId ?? null,
      ],
      { name: 'service.updateTimetable', primary: true },
    );
    if (n === 0) throw new NotFoundError('Service', id);
  }

  /** Snapshot the service's current timetable as its next version. Runs in the caller's unit of work. */
  async snapshotVersion(id: ServiceId, note: string, actorId: string | null): Promise<number> {
    const row = await this.db.queryOne<{ n: number }>(
      `INSERT INTO service_versions (service_id, version_number, tenant_id, snapshot, note, created_by)
       SELECT s.id,
              coalesce((SELECT max(version_number) FROM service_versions v WHERE v.service_id = s.id), 0) + 1,
              s.tenant_id,
              jsonb_build_object('startMinute', s.start_minute, 'recurrence', s.recurrence,
                                 'vehicleTypeId', s.vehicle_type_id, 'defaultVehicleId', s.default_vehicle_id),
              $3, $4
         FROM services s WHERE s.tenant_id = $1 AND s.id = $2
       RETURNING version_number AS n`,
      [requireTenantId(), id, note, actorId],
      { name: 'service.snapshotVersion', primary: true },
    );
    if (!row) throw new NotFoundError('Service', id);
    return row.n;
  }

  listVersions(id: ServiceId): Promise<ServiceVersion[]> {
    return this.db.query<ServiceVersion>(
      `SELECT version_number AS "versionNumber", snapshot, note, created_by AS "createdBy", created_at AS "createdAt"
         FROM service_versions WHERE tenant_id = $1 AND service_id = $2 ORDER BY version_number DESC`,
      [requireTenantId(), id],
      { name: 'service.listVersions' },
    );
  }

  getVersion(id: ServiceId, versionNumber: number): Promise<ServiceVersion | null> {
    return this.db.queryOne<ServiceVersion>(
      `SELECT version_number AS "versionNumber", snapshot, note, created_by AS "createdBy", created_at AS "createdAt"
         FROM service_versions WHERE tenant_id = $1 AND service_id = $2 AND version_number = $3`,
      [requireTenantId(), id, versionNumber],
      { name: 'service.getVersion', primary: true },
    );
  }

  /** A draft copy of a service under a new code (#266, #272): same route, bus, rules; new timetable. */
  async clone(
    sourceId: ServiceId,
    input: { code: string; startMinute: number; recurrence: RecurrenceRule },
  ): Promise<ServiceId> {
    const id = newId() as ServiceId;
    const n = await this.db.execute_(
      `INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, default_vehicle_id,
                             start_minute, recurrence, closed_channels, sales_rules)
       SELECT $3, tenant_id, $4, route_id, vehicle_type_id, default_vehicle_id, $5, $6, closed_channels, sales_rules
         FROM services WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        requireTenantId(),
        sourceId,
        id,
        input.code.trim(),
        input.startMinute,
        JSON.stringify(input.recurrence),
      ],
      { name: 'service.clone', primary: true },
    );
    if (n === 0) throw new NotFoundError('Service', sourceId);
    return id;
  }

  /** What deleting a service would destroy: trips that already carry history. */
  async deletionBlockers(
    id: ServiceId,
  ): Promise<{ bookedTrips: number; ranTrips: number; tripsWithExpenses: number }> {
    const row = await this.db.queryOne<{ booked: string; ran: string; expenses: string }>(
      `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id)) AS booked,
              count(*) FILTER (WHERE t.status NOT IN ('scheduled', 'open', 'cancelled')) AS ran,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM trip_expenses e WHERE e.trip_id = t.id)) AS expenses
         FROM trips t WHERE t.tenant_id = $1 AND t.service_id = $2`,
      [requireTenantId(), id],
      { name: 'service.deletionBlockers', primary: true },
    );
    return {
      bookedTrips: Number(row?.booked ?? 0),
      ranTrips: Number(row?.ran ?? 0),
      tripsWithExpenses: Number(row?.expenses ?? 0),
    };
  }

  /** Permanently remove a service and its (unbooked, never-run) trips (#169). */
  async hardDelete(id: ServiceId): Promise<number> {
    const trips = await this.db.execute_(
      `DELETE FROM trips WHERE tenant_id = $1 AND service_id = $2`,
      [requireTenantId(), id],
      { name: 'service.deleteTrips', primary: true },
    );
    const n = await this.db.execute_(
      `DELETE FROM services WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'service.hardDelete', primary: true },
    );
    if (n === 0) throw new NotFoundError('Service', id);
    return trips;
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
