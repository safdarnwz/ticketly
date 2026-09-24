import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, NotFoundError, requireTenantId, type CityId, type StopId } from '@kernel';

export type StopKind = 'boarding' | 'dropping' | 'both';

export interface Stop {
  id: StopId;
  cityId: CityId;
  name: string;
  kind: StopKind;
  landmark: string | null;
  address?: string | null;
  pincode?: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  isActive: boolean;
}

/**
 * Operator-owned boarding/dropping points. Tenant-scoped (RLS + explicit
 * predicate). Small per-operator dataset, read on every route edit and search.
 */
@Injectable()
export class StopRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: { cityId: CityId; name: string; kind?: StopKind; landmark?: string; address?: string; pincode?: string; latitude?: number; longitude?: number; contactPhone?: string }): Promise<StopId> {
    const id = newId() as StopId;
    await this.db.execute_(
      `INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, address, pincode, latitude, longitude, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, requireTenantId(), input.cityId, input.name.trim(), input.kind ?? 'both',
       input.landmark ?? null, input.address ?? null, input.pincode ?? null, input.latitude ?? null, input.longitude ?? null, input.contactPhone ?? null],
      { name: 'stop.create', primary: true },
    );
    return id;
  }

  /** Bulk-import — each row independently validated/inserted; a bad row is skipped and reported, never aborting the whole batch (an operator importing 200 stops shouldn't lose all 200 because row 47 had a typo). */
  async bulkImport(rows: Array<{ cityId: CityId; name: string; kind?: StopKind; landmark?: string; address?: string; pincode?: string; latitude?: number; longitude?: number; contactPhone?: string }>): Promise<{ imported: number; failed: { row: number; error: string }[] }> {
    let imported = 0;
    const failed: { row: number; error: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        if (!rows[i].name?.trim() || !rows[i].cityId) throw new Error('name and cityId are required');
        await this.create(rows[i]);
        imported += 1;
      } catch (e) {
        failed.push({ row: i + 1, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return { imported, failed };
  }

  async update(id: StopId, input: { name?: string; kind?: StopKind; landmark?: string; address?: string; pincode?: string; latitude?: number; longitude?: number; contactPhone?: string }): Promise<void> {
    await this.db.execute_(
      `UPDATE stops SET
         name = coalesce($3, name), kind = coalesce($4, kind), landmark = coalesce($5, landmark),
         address = coalesce($6, address), pincode = coalesce($7, pincode),
         latitude = coalesce($8, latitude), longitude = coalesce($9, longitude), contact_phone = coalesce($10, contact_phone)
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, input.name?.trim() ?? null, input.kind ?? null, input.landmark ?? null,
       input.address ?? null, input.pincode ?? null, input.latitude ?? null, input.longitude ?? null, input.contactPhone ?? null],
      { name: 'stop.update', primary: true },
    );
  }

  async setActive(id: StopId, isActive: boolean): Promise<void> {
    await this.db.execute_(
      `UPDATE stops SET is_active = $3 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, isActive],
      { name: 'stop.setActive', primary: true },
    );
  }

  /** Staff-management list — ALL stops (active + inactive), unlike listByCity (customer search, active only). */
  async listAll(): Promise<Stop[]> {
    const rows = await this.db.query<StopRow>(
      `SELECT id, city_id, name, kind, landmark, address, pincode, latitude, longitude, contact_phone, is_active
         FROM stops WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [requireTenantId()],
      { name: 'stop.listAll' },
    );
    return rows.map(mapStop);
  }

  async findById(id: StopId): Promise<Stop | null> {
    const row = await this.db.queryOne<StopRow>(
      `SELECT id, city_id, name, kind, landmark, address, pincode, latitude, longitude, contact_phone, is_active
         FROM stops WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'stop.findById' },
    );
    return row ? mapStop(row) : null;
  }

  async loadMany(ids: readonly StopId[]): Promise<Map<StopId, Stop>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.query<StopRow>(
      `SELECT id, city_id, name, kind, landmark, latitude, longitude, contact_phone, is_active
         FROM stops WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [requireTenantId(), ids],
      { name: 'stop.loadMany' },
    );
    return new Map(rows.map((r) => [r.id, mapStop(r)]));
  }

  async listByCity(cityId: CityId): Promise<Stop[]> {
    const rows = await this.db.query<StopRow>(
      `SELECT id, city_id, name, kind, landmark, address, pincode, latitude, longitude, contact_phone, is_active
         FROM stops WHERE tenant_id = $1 AND city_id = $2 AND is_active = true AND deleted_at IS NULL
        ORDER BY name`,
      [requireTenantId(), cityId],
      { name: 'stop.listByCity' },
    );
    return rows.map(mapStop);
  }

  async assertExist(ids: readonly StopId[]): Promise<void> {
    const found = await this.loadMany(ids);
    for (const id of ids) if (!found.has(id)) throw new NotFoundError('Stop', id);
  }
}

interface StopRow {
  id: StopId; city_id: CityId; name: string; kind: StopKind; landmark: string | null;
  address?: string | null; pincode?: string | null;
  latitude: number | null; longitude: number | null; contact_phone: string | null; is_active: boolean;
}
function mapStop(row: StopRow): Stop {
  return {
    id: row.id, cityId: row.city_id, name: row.name, kind: row.kind, landmark: row.landmark,
    address: row.address, pincode: row.pincode,
    latitude: row.latitude, longitude: row.longitude, contactPhone: row.contact_phone, isActive: row.is_active,
  };
}
