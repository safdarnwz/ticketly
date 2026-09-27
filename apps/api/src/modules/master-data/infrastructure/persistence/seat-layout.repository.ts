import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService, registerConstraintMessages } from '@database';
import {
  AppError,
  ErrorCode,
  newId,
  NotFoundError,
  requireTenantId,
  type Json,
  type SeatLayoutId,
} from '@kernel';

import { SeatMap } from '../../seat-layout/domain/seat-map';

registerConstraintMessages({
  seat_layouts_tenant_id_name_key: 'A seat layout with this name already exists',
});

export interface SeatLayoutRecord {
  id: SeatLayoutId;
  name: string;
  seatMap: SeatMap;
  isActive: boolean;
}

/**
 * Seat-layout repository.
 *
 * The seat map is stored as validated jsonb and reconstructed through
 * `SeatMap.fromPersistence`, so a row can never yield an invalid map at runtime
 * — if the DB somehow held a bad layout, construction throws loudly rather than
 * silently producing a broken booking grid.
 *
 * Layouts are read on every trip materialisation and every seat-map render, so
 * reads are cache-backed with a long TTL and invalidated on write.
 */
@Injectable()
export class SeatLayoutRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  async create(name: string, seatMap: SeatMap): Promise<SeatLayoutId> {
    const id = newId() as SeatLayoutId;
    const s = seatMap.summary;
    await this.db.execute_(
      `INSERT INTO seat_layouts (id, tenant_id, name, decks, total_seats, seater_count, sleeper_count, layout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        requireTenantId(),
        name.trim(),
        s.decks,
        s.totalSeats,
        s.seater,
        s.sleeper,
        JSON.stringify(seatMap.toPersistence()),
      ],
      { name: 'layout.create', primary: true },
    );
    return id;
  }

  /**
   * Edit an existing layout in place. Deliberately allowed even when a
   * vehicle already uses it (no hard block) — but be aware this changes the
   * seat MAP a vehicle presents going forward; it does not retroactively
   * touch already-issued tickets (those keep whatever seat number they were
   * sold with), but a mismatched row/column count vs what customers expect
   * on an ALREADY-scheduled trip could be confusing. Best practice is to
   * only edit a layout that's unused, or one only assigned to vehicles with
   * no upcoming trips yet.
   */
  async update(id: SeatLayoutId, name: string, seatMap: SeatMap): Promise<void> {
    const s = seatMap.summary;
    await this.db.execute_(
      `UPDATE seat_layouts SET name = $3, decks = $4, total_seats = $5, seater_count = $6, sleeper_count = $7, layout = $8
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        requireTenantId(),
        id,
        name.trim(),
        s.decks,
        s.totalSeats,
        s.seater,
        s.sleeper,
        JSON.stringify(seatMap.toPersistence()),
      ],
      { name: 'layout.update', primary: true },
    );
    await this.cache.invalidate(id, CacheNamespace.SEAT_LAYOUT);
  }

  /**
   * Snapshot the CURRENT state into version history — called right after
   * every create/update/restore, inside the SAME transaction (the service
   * layer's uow.run wraps both), so a version row and the layout it
   * describes are always written atomically together.
   */
  async snapshotVersion(
    id: SeatLayoutId,
    name: string,
    seatMap: SeatMap,
    changedBy: string | null,
    note?: string,
  ): Promise<number> {
    const next = await this.db.queryOne<{ n: number }>(
      `SELECT coalesce(max(version_number), 0) + 1 AS n FROM seat_layout_versions WHERE tenant_id = $1 AND seat_layout_id = $2`,
      [requireTenantId(), id],
      { name: 'layout.nextVersion', primary: true },
    );
    const versionNumber = next?.n ?? 1;
    await this.db.execute_(
      `INSERT INTO seat_layout_versions (id, tenant_id, seat_layout_id, version_number, name, layout, changed_by, change_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        newId(),
        requireTenantId(),
        id,
        versionNumber,
        name.trim(),
        JSON.stringify(seatMap.toPersistence()),
        changedBy,
        note ?? null,
      ],
      { name: 'layout.snapshotVersion', primary: true },
    );
    return versionNumber;
  }

  async listVersions(id: SeatLayoutId): Promise<
    {
      versionNumber: number;
      name: string;
      changedBy: string | null;
      changeNote: string | null;
      createdAt: Date;
      summary: unknown;
    }[]
  > {
    const rows = await this.db.query<{
      version_number: number;
      name: string;
      changed_by: string | null;
      change_note: string | null;
      created_at: Date;
      layout: unknown;
    }>(
      `SELECT version_number, name, changed_by, change_note, created_at, layout FROM seat_layout_versions
        WHERE tenant_id = $1 AND seat_layout_id = $2 ORDER BY version_number DESC`,
      [requireTenantId(), id],
      { name: 'layout.listVersions' },
    );
    return rows.map((r) => ({
      versionNumber: r.version_number,
      name: r.name,
      changedBy: r.changed_by,
      changeNote: r.change_note,
      createdAt: r.created_at,
      summary: SeatMap.create(r.layout as never).summary,
    }));
  }

  async getVersion(
    id: SeatLayoutId,
    versionNumber: number,
  ): Promise<{ name: string; layout: unknown } | null> {
    const row = await this.db.queryOne<{ name: string; layout: unknown }>(
      `SELECT name, layout FROM seat_layout_versions WHERE tenant_id = $1 AND seat_layout_id = $2 AND version_number = $3`,
      [requireTenantId(), id, versionNumber],
      { name: 'layout.getVersion' },
    );
    return row;
  }

  async findById(id: SeatLayoutId): Promise<SeatLayoutRecord | null> {
    return this.cache.getOrLoad<SeatLayoutRecord | null>(
      id,
      { namespace: CacheNamespace.SEAT_LAYOUT, ttlSeconds: CacheTtl.MASTER_DATA },
      async () => {
        const row = await this.db.queryOne<LayoutRow>(
          `SELECT id, name, layout, is_active FROM seat_layouts
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [requireTenantId(), id],
          { name: 'layout.findById' },
        );
        if (!row) return null;
        return {
          id: row.id,
          name: row.name,
          seatMap: SeatMap.fromPersistence(row.layout),
          isActive: row.is_active,
        };
      },
    );
  }

  async getById(id: SeatLayoutId): Promise<SeatLayoutRecord> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Seat layout', id);
    return found;
  }

  async list(): Promise<{ id: SeatLayoutId; name: string; totalSeats: number; decks: number }[]> {
    const rows = await this.db.query<{
      id: SeatLayoutId;
      name: string;
      total_seats: number;
      decks: number;
    }>(
      `SELECT id, name, total_seats, decks FROM seat_layouts
        WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [requireTenantId()],
      { name: 'layout.list' },
    );
    return rows.map((r) => ({ id: r.id, name: r.name, totalSeats: r.total_seats, decks: r.decks }));
  }

  /** How many vehicles currently reference this layout — either directly, or via a vehicle type that uses it. Shown before delete so staff don't accidentally break an in-use layout. */
  async usageCount(id: SeatLayoutId): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(DISTINCT v.id) AS n FROM vehicles v
        LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       WHERE v.tenant_id = $1 AND (v.seat_layout_id = $2 OR vt.seat_layout_id = $2)`,
      [requireTenantId(), id],
      { name: 'layout.usageCount', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  /** Trips still to run (or on the road) that sell their seats from this layout. */
  async upcomingTripCount(id: SeatLayoutId): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM trips
        WHERE tenant_id = $1 AND seat_layout_id = $2 AND status IN ('scheduled', 'open', 'departed')`,
      [requireTenantId(), id],
      { name: 'layout.upcomingTrips', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  /** Soft-delete — refuses if any vehicle still references it (see usageCount), so a layout can never vanish out from under an active bus. */
  async delete(id: SeatLayoutId): Promise<void> {
    const inUse = await this.usageCount(id);
    if (inUse > 0) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 409, {
        message: `Still used by ${inUse} vehicle(s) — reassign them to a different layout first`,
      });
    }
    await this.db.execute_(
      `UPDATE seat_layouts SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'layout.delete', primary: true },
    );
    await this.cache.invalidate(id, CacheNamespace.SEAT_LAYOUT);
  }

  async invalidate(id: SeatLayoutId): Promise<void> {
    await this.cache.invalidate(id, CacheNamespace.SEAT_LAYOUT);
  }
}

interface LayoutRow {
  id: SeatLayoutId;
  name: string;
  layout: Json;
  is_active: boolean;
}
