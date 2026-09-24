import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId, type LocalDate, type VehicleId } from '@kernel';

/** Maintenance & fuel history. Simple append-only operational logs. */
@Injectable()
export class FleetLogsRepository {
  constructor(private readonly db: DatabaseService) {}

  async addMaintenance(
    vehicleId: VehicleId,
    input: {
      kind: string;
      description: string;
      odometerKm?: number;
      costMinor: number;
      performedOn: LocalDate;
      nextDueOn?: LocalDate;
    },
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO maintenance_logs (id, tenant_id, vehicle_id, kind, description, odometer_km, cost_minor, performed_on, next_due_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        newId(),
        requireTenantId(),
        vehicleId,
        input.kind,
        input.description,
        input.odometerKm ?? null,
        input.costMinor,
        input.performedOn,
        input.nextDueOn ?? null,
      ],
      { name: 'fleet.addMaintenance', primary: true },
    );
  }

  async listMaintenance(vehicleId: VehicleId, limit = 50): Promise<unknown[]> {
    return this.db.query(
      `SELECT kind, description, odometer_km AS "odometerKm", cost_minor AS "costMinor",
              performed_on AS "performedOn", next_due_on AS "nextDueOn"
         FROM maintenance_logs WHERE tenant_id = $1 AND vehicle_id = $2
        ORDER BY performed_on DESC LIMIT $3`,
      [requireTenantId(), vehicleId, limit],
      { name: 'fleet.listMaintenance' },
    );
  }

  async addFuel(
    vehicleId: VehicleId,
    input: { litres: number; costMinor: number; odometerKm?: number; filledOn: LocalDate },
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO fuel_logs (id, tenant_id, vehicle_id, litres, cost_minor, odometer_km, filled_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId(),
        requireTenantId(),
        vehicleId,
        input.litres,
        input.costMinor,
        input.odometerKm ?? null,
        input.filledOn,
      ],
      { name: 'fleet.addFuel', primary: true },
    );
  }
}
