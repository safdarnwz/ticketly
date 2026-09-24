import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId, type AmenityId } from '@kernel';

export interface Amenity {
  id: AmenityId;
  code: string;
  name: string;
  icon: string | null;
}

@Injectable()
export class AmenityRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: { code: string; name: string; icon?: string }): Promise<AmenityId> {
    const id = newId() as AmenityId;
    await this.db.execute_(
      `INSERT INTO amenities (id, tenant_id, code, name, icon) VALUES ($1,$2,$3,$4,$5)`,
      [id, requireTenantId(), input.code.trim(), input.name.trim(), input.icon ?? null],
      { name: 'amenity.create', primary: true },
    );
    return id;
  }

  async list(): Promise<Amenity[]> {
    const rows = await this.db.query<{
      id: AmenityId;
      code: string;
      name: string;
      icon: string | null;
    }>(
      `SELECT id, code, name, icon FROM amenities WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [requireTenantId()],
      { name: 'amenity.list' },
    );
    return rows;
  }

  /**
   * Batch-resolves the actual amenities for a set of VEHICLES (not vehicle
   * TYPES directly) — vehicle_types.amenity_ids is the source of truth, so
   * this joins vehicle -> vehicle_type -> amenities in one query rather than
   * N+1-ing per search result. Vehicles with no amenity_ids, a vehicle_type
   * whose amenity_ids references a deleted/inactive amenity (is_active
   * check below), or a null vehicleId in the input are simply absent from
   * the returned map — callers treat a missing key as "no amenities known
   * yet", never as an error.
   */
  async forVehicleIds(vehicleIds: readonly string[]): Promise<Map<string, Amenity[]>> {
    const result = new Map<string, Amenity[]>();
    if (vehicleIds.length === 0) return result;
    const rows = await this.db.query<{
      vehicle_id: string;
      id: AmenityId;
      code: string;
      name: string;
      icon: string | null;
    }>(
      `SELECT v.id AS vehicle_id, a.id, a.code, a.name, a.icon
         FROM vehicles v
         JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
         JOIN amenities a ON a.id = ANY(vt.amenity_ids) AND a.is_active = true
        WHERE v.tenant_id = $1 AND v.id = ANY($2::uuid[])`,
      [requireTenantId(), vehicleIds],
      { name: 'amenity.forVehicleIds' },
    );
    for (const r of rows) {
      const list = result.get(r.vehicle_id) ?? [];
      list.push({ id: r.id, code: r.code, name: r.name, icon: r.icon });
      result.set(r.vehicle_id, list);
    }
    return result;
  }
}
