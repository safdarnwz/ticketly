import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { newId, requireTenantId } from '@kernel';

import type { StateNorm, StateNormCategory } from '../../domain/state-norms';

registerConstraintMessages({
  state_norms_title_key: 'This state already has a rule with this title',
});

interface NormRow {
  id: string;
  stateId: string;
  stateName: string;
  category: StateNormCategory;
  title: string;
  body: string;
  isActive: boolean;
  updatedAt: Date;
}

const SELECT = `SELECT n.id, n.state_id AS "stateId", s.name AS "stateName", n.category, n.title, n.body,
                       n.is_active AS "isActive", n.updated_at AS "updatedAt"
                  FROM state_norms n JOIN states s ON s.id = n.state_id`;

/** Platform rules per state; and which states a route (or a set of cities) passes through. */
@Injectable()
export class StateNormRepository {
  constructor(private readonly db: DatabaseService) {}

  states(): Promise<{ id: string; code: string; name: string }[]> {
    return this.db.query(`SELECT id, code, name FROM states ORDER BY name`, [], {
      name: 'stateNorm.states',
    });
  }

  stateExists(stateId: string): Promise<boolean> {
    return this.db
      .queryOne<{ id: string }>(`SELECT id FROM states WHERE id = $1`, [stateId], {
        name: 'stateNorm.stateExists',
      })
      .then(Boolean);
  }

  list(filter: { stateId?: string; includeInactive?: boolean }): Promise<StateNorm[]> {
    return this.db.query<NormRow>(
      `${SELECT}
        WHERE ($1::uuid IS NULL OR n.state_id = $1) AND ($2 OR n.is_active)
        ORDER BY s.name, n.category, n.title`,
      [filter.stateId ?? null, filter.includeInactive ?? false],
      { name: 'stateNorm.list', primary: true },
    );
  }

  get(id: string): Promise<StateNorm | null> {
    return this.db.queryOne<NormRow>(`${SELECT} WHERE n.id = $1`, [id], {
      name: 'stateNorm.get',
      primary: true,
    });
  }

  /** Active rules of these states. */
  forStates(stateIds: string[]): Promise<StateNorm[]> {
    if (stateIds.length === 0) return Promise.resolve([]);
    return this.db.query<NormRow>(
      `${SELECT} WHERE n.state_id = ANY($1::uuid[]) AND n.is_active ORDER BY n.category, n.title`,
      [stateIds],
      { name: 'stateNorm.forStates' },
    );
  }

  async create(input: {
    stateId: string;
    category: StateNormCategory;
    title: string;
    body: string;
    by: string | null;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO state_norms (id, state_id, category, title, body, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, input.stateId, input.category, input.title, input.body, input.by],
      { name: 'stateNorm.create', primary: true },
    );
    return id;
  }

  /** False when there is no such rule. */
  async update(
    id: string,
    patch: {
      category?: StateNormCategory;
      title?: string;
      body?: string;
      isActive?: boolean;
      by: string | null;
    },
  ): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE state_norms SET
         category = coalesce($2, category), title = coalesce($3, title), body = coalesce($4, body),
         is_active = coalesce($5, is_active), updated_by = $6, updated_at = now()
       WHERE id = $1`,
      [
        id,
        patch.category ?? null,
        patch.title ?? null,
        patch.body ?? null,
        patch.isActive ?? null,
        patch.by,
      ],
      { name: 'stateNorm.update', primary: true },
    );
    return n > 0;
  }

  /** The states a route's stops are in, in the order the bus reaches them. */
  statesOfRoute(routeId: string): Promise<{ id: string; name: string }[]> {
    return this.db.query(
      `SELECT st.id, st.name
         FROM route_stops rs
         JOIN stops s ON s.id = rs.stop_id
         JOIN cities c ON c.id = s.city_id
         JOIN states st ON st.id = c.state_id
        WHERE rs.tenant_id = $1 AND rs.route_id = $2
        GROUP BY st.id, st.name
        ORDER BY min(rs.sequence)`,
      [requireTenantId(), routeId],
      { name: 'stateNorm.statesOfRoute' },
    );
  }

  /** The states of these cities, in the order given. */
  statesOfCities(cityIds: string[]): Promise<{ id: string; name: string }[]> {
    if (cityIds.length === 0) return Promise.resolve([]);
    return this.db.query(
      `SELECT st.id, st.name
         FROM unnest($1::uuid[]) WITH ORDINALITY AS x(city_id, ord)
         JOIN cities c ON c.id = x.city_id
         JOIN states st ON st.id = c.state_id
        GROUP BY st.id, st.name
        ORDER BY min(x.ord)`,
      [cityIds],
      { name: 'stateNorm.statesOfCities' },
    );
  }

  routeExists(routeId: string): Promise<boolean> {
    return this.db
      .queryOne<{ id: string }>(
        `SELECT id FROM routes WHERE tenant_id = $1 AND id = $2`,
        [requireTenantId(), routeId],
        { name: 'stateNorm.routeExists' },
      )
      .then(Boolean);
  }
}
