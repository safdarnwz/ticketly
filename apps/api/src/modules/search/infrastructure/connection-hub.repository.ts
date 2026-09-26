import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import type { CityId } from '@kernel';

import type { OperatorConnectionRule } from '../domain/connecting-journey';

export interface HubCity {
  cityId: CityId;
  name: string;
}

/**
 * Where can a traveller change buses between two cities? A hub is a city that
 * some active operator's published route reaches from the origin, and some
 * (possibly different) operator's published route leaves for the
 * destination. Cross-operator by nature, so it reads routes with RLS
 * bypassed — it returns city ids and names only, never operator data.
 */
@Injectable()
export class ConnectionHubRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async hubsBetween(originCityId: CityId, destCityId: CityId, limit: number): Promise<HubCity[]> {
    if (originCityId === destCityId) return [];
    return this.uow.run(
      { name: 'search.hubsBetween', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<{ city_id: CityId; name: string }>(
          `SELECT c.id AS city_id, c.name
           FROM cities c
          WHERE c.id NOT IN ($1, $2)
            AND EXISTS (SELECT 1 FROM routes r JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
                         WHERE r.origin_city_id = $1 AND r.dest_city_id = c.id AND r.status = 'published' AND r.deleted_at IS NULL)
            AND EXISTS (SELECT 1 FROM routes r JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
                         WHERE r.origin_city_id = c.id AND r.dest_city_id = $2 AND r.status = 'published' AND r.deleted_at IS NULL)
          ORDER BY c.name
          LIMIT $3`,
          [originCityId, destCityId, limit],
        );
        return r.rows.map((row) => ({ cityId: row.city_id, name: row.name }));
      },
    );
  }

  /** Each operator's own connection rule (null when it keeps the platform default). */
  async connectionRules(tenantIds: string[]): Promise<Map<string, OperatorConnectionRule>> {
    if (!tenantIds.length) return new Map();
    return this.uow.run(
      { name: 'search.connectionRules', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<{ id: string; rules: OperatorConnectionRule }>(
          `SELECT id, settings->'connections' AS rules FROM tenants
            WHERE id = ANY($1::uuid[]) AND settings ? 'connections'`,
          [tenantIds],
        );
        return new Map(r.rows.map((row) => [row.id, row.rules]));
      },
    );
  }
}
