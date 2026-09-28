import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService, UnitOfWork } from '@database';
import type { CityId, StateId } from '@kernel';

export interface City {
  id: CityId;
  stateId: StateId;
  name: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  aliases: string[];
}

/**
 * Geography read repository (shared platform data).
 *
 * City lookups back every search box, so they are cache-backed with a long TTL.
 * Autocomplete uses a trigram index (`pg_trgm`) rather than `LIKE '%q%'`, which
 * cannot use an index and degrades linearly with the catalogue size.
 */
@Injectable()
export class GeographyRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly uow: UnitOfWork,
  ) {}

  async findCity(id: CityId): Promise<City | null> {
    return this.cache.getOrLoad(
      `city:${id}`,
      { namespace: CacheNamespace.GEO, ttlSeconds: CacheTtl.MASTER_DATA },
      async () => {
        const row = await this.db.queryOne<CityRow>(
          `SELECT id, state_id, name, latitude, longitude, timezone, aliases
             FROM cities WHERE id = $1 AND is_active = true`,
          [id],
          { name: 'geo.findCity' },
        );
        return row ? mapCity(row) : null;
      },
    );
  }

  /**
   * Resolves a URL-safe slug (e.g. "new-delhi") back to the real city —
   * the slug is DERIVED from the name on the fly (lower-cased, spaces to
   * hyphens), never a stored column, so there's nothing to keep in sync
   * when a city is renamed. This is what lets /results?from=delhi&to=jaipur
   * exist at all — the alternative (the city's raw UUID in the URL) is
   * exactly what this endpoint exists to avoid; see ResultsPage/HomePage,
   * which build the URL with slugifyCityName() (the frontend's OWN copy of
   * this exact same derivation — see that function's own comment for why
   * both sides must stay byte-for-byte identical).
   *
   * DISAMBIGUATION: India genuinely has multiple towns sharing a name
   * across different states (a small town literally named the same as a
   * bigger one elsewhere is common, not an edge case to dismiss). Rather
   * than a manually-curated "is this a major city" flag someone has to
   * remember to set for every new city, this uses a REAL, self-maintaining
   * signal: whichever matching city has more routes serving it wins the
   * bare slug — a town with fifty daily services is unambiguously the one
   * a bare "/results?from=..." URL means, the way plain city-name URLs on
   * Indian bus booking sites resolve in practice. The
   * losing city is never unreachable — it's still found by the normal
   * fuzzy-autocomplete search (searchCities), just not by guessing its
   * bare slug in a URL.
   */
  async findBySlug(slug: string): Promise<City | null> {
    // bypassRls is required here — routes has tenant-scoped RLS, and this
    // is a PUBLIC endpoint with no tenant bound at all. Without bypassing,
    // current_tenant_id() is NULL, and "tenant_id IS NOT DISTINCT FROM
    // NULL" matches no real row (every route has a real tenant_id) — the
    // route_count below would silently be 0 for every city, every time,
    // and the whole point of this disambiguation (favour whichever city
    // actually has service) would quietly never fire.
    const rows = await this.uow.run({ name: 'geo.findBySlug', bypassRls: true }, async (scope) =>
      scope.client.query<CityRow & { route_count: string }>(
        `SELECT c.id, c.state_id, c.name, c.latitude, c.longitude, c.timezone, c.aliases,
                (SELECT count(*) FROM routes r WHERE r.origin_city_id = c.id OR r.dest_city_id = c.id) AS route_count
           FROM cities c
          WHERE c.is_active = true
            AND lower(regexp_replace(regexp_replace(c.name, '[^a-zA-Z0-9\\s-]', '', 'g'), '\\s+', '-', 'g')) = $1
          ORDER BY route_count DESC, c.name
          LIMIT 1`,
        [slug.trim().toLowerCase()],
      ),
    );
    return rows.rows[0] ? mapCity(rows.rows[0]) : null;
  }

  /** Fuzzy autocomplete over city name + aliases. Trigram-indexed. */
  async searchCities(query: string, limit = 10): Promise<City[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const rows = await this.db.query<CityRow>(
      `SELECT id, state_id, name, latitude, longitude, timezone, aliases,
              similarity(name, $1) AS score
         FROM cities
        WHERE is_active = true
          AND (name % $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a % $1))
        ORDER BY score DESC, name
        LIMIT $2`,
      [q, limit],
      { name: 'geo.searchCities' },
    );
    return rows.map(mapCity);
  }

  async loadCities(ids: readonly CityId[]): Promise<Map<CityId, City>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.query<CityRow>(
      `SELECT id, state_id, name, latitude, longitude, timezone, aliases FROM cities WHERE id = ANY($1)`,
      [ids],
      { name: 'geo.loadCities' },
    );
    return new Map(rows.map((r) => [r.id, mapCity(r)]));
  }
}

interface CityRow {
  id: CityId;
  state_id: StateId;
  name: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  aliases: string[];
}

function mapCity(row: CityRow): City {
  return {
    id: row.id,
    stateId: row.state_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    aliases: row.aliases ?? [],
  };
}
