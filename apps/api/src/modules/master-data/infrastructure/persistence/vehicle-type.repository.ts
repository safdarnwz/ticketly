import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { newId, NotFoundError, requireTenantId, type SeatLayoutId, type Uuid, type VehicleTypeId } from '@kernel';

registerConstraintMessages({ vehicle_types_tenant_id_code_key: 'A vehicle type with this code already exists' });

export interface VehicleType {
  id: VehicleTypeId;
  name: string;
  code: string;
  isAc: boolean;
  seatLayoutId: SeatLayoutId | null;
  amenityIds: Uuid[];
  isActive: boolean;
}

/** Bus classes (AC Sleeper, Non-AC Seater …) bound to a default seat layout. */
@Injectable()
export class VehicleTypeRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: { name: string; code: string; isAc?: boolean; seatLayoutId?: SeatLayoutId; amenityIds?: Uuid[] }): Promise<VehicleTypeId> {
    const id = newId() as VehicleTypeId;
    await this.db.execute_(
      `INSERT INTO vehicle_types (id, tenant_id, name, code, is_ac, seat_layout_id, amenity_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, requireTenantId(), input.name.trim(), input.code.trim(), input.isAc ?? false, input.seatLayoutId ?? null, input.amenityIds ?? []],
      { name: 'vtype.create', primary: true },
    );
    return id;
  }

  async findById(id: VehicleTypeId): Promise<VehicleType | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, name, code, is_ac, seat_layout_id, amenity_ids, is_active
         FROM vehicle_types WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'vtype.findById' },
    );
    return row ? map(row) : null;
  }

  async getById(id: VehicleTypeId): Promise<VehicleType> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Vehicle type', id);
    return found;
  }

  async list(): Promise<VehicleType[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, name, code, is_ac, seat_layout_id, amenity_ids, is_active
         FROM vehicle_types WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [requireTenantId()],
      { name: 'vtype.list' },
    );
    return rows.map(map);
  }
}

interface Row {
  id: VehicleTypeId; name: string; code: string; is_ac: boolean;
  seat_layout_id: SeatLayoutId | null; amenity_ids: Uuid[]; is_active: boolean;
}
function map(r: Row): VehicleType {
  return { id: r.id, name: r.name, code: r.code, isAc: r.is_ac, seatLayoutId: r.seat_layout_id, amenityIds: r.amenity_ids ?? [], isActive: r.is_active };
}
