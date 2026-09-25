import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type RouteId } from '@kernel';

export interface RouteBlackout {
  date: string;
  reason: string;
  createdAt: Date;
}

/** Dates a route does not run (#271). Materialisation skips them. */
@Injectable()
export class RouteBlackoutRepository {
  constructor(private readonly db: DatabaseService) {}

  async add(
    routeId: RouteId,
    dates: string[],
    reason: string,
    actorId: string | null,
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO route_blackouts (tenant_id, route_id, blackout_date, reason, created_by)
       SELECT $1, $2, d, $4, $5 FROM unnest($3::date[]) AS d
       ON CONFLICT (route_id, blackout_date) DO UPDATE SET reason = EXCLUDED.reason`,
      [requireTenantId(), routeId, dates, reason, actorId],
      { name: 'routeBlackout.add', primary: true },
    );
  }

  async remove(routeId: RouteId, dates: string[]): Promise<number> {
    return this.db.execute_(
      `DELETE FROM route_blackouts WHERE tenant_id = $1 AND route_id = $2 AND blackout_date = ANY($3::date[])`,
      [requireTenantId(), routeId, dates],
      { name: 'routeBlackout.remove', primary: true },
    );
  }

  list(routeId: RouteId): Promise<RouteBlackout[]> {
    return this.db.query<RouteBlackout>(
      `SELECT blackout_date::text AS date, reason, created_at AS "createdAt"
         FROM route_blackouts WHERE tenant_id = $1 AND route_id = $2 AND blackout_date >= current_date
        ORDER BY blackout_date`,
      [requireTenantId(), routeId],
      { name: 'routeBlackout.list' },
    );
  }

  /** Blackout dates of a route (for materialisation). */
  async dates(routeId: RouteId): Promise<string[]> {
    const rows = await this.db.query<{ d: string }>(
      `SELECT blackout_date::text AS d FROM route_blackouts WHERE tenant_id = $1 AND route_id = $2`,
      [requireTenantId(), routeId],
      { name: 'routeBlackout.dates', primary: true },
    );
    return rows.map((r) => r.d);
  }
}
