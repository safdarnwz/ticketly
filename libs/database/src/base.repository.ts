import type { QueryResultRow } from 'pg';

import {
  buildPage,
  NotFoundError,
  OptimisticLockError,
  requireTenantId,
  type Page,
  type PageRequest,
  type TenantId,
  type Uuid,
} from '@kernel';

import type { DatabaseService, QueryOptions } from './database.service';
import { join, keysetPredicate, sql, where, type SqlFragment } from './sql';

/**
 * ============================================================================
 *  BaseRepository
 * ============================================================================
 *
 * A thin, opinionated base for tenant-scoped aggregates. It is deliberately
 * small: it removes the boilerplate that is identical everywhere (tenant
 * predicate, keyset pagination, optimistic locking, row→domain mapping) and
 * refuses to invent a query language. Anything non-trivial is hand-written SQL
 * in the concrete repository.
 *
 * THE ONE RULE: `tenantId` is injected from the ambient request context, never
 * accepted as a method parameter. A caller therefore *cannot* pass the wrong
 * tenant, and a missing context throws instead of querying globally.
 */
export abstract class BaseRepository<TDomain, TRow extends QueryResultRow> {
  protected abstract readonly table: string;
  /**
   * Columns selected by the default finders. Never `SELECT *` — an explicit
   * list keeps index-only scans possible and stops a new `bytea` column from
   * silently tripling every response payload.
   *
   * CONVENTION: alias snake_case columns to camelCase here
   * (`created_at AS "createdAt"`). Postgres does the renaming for free, so no
   * per-row JS transformation is needed on the hot path.
   */
  protected abstract readonly columns: string;
  /** Sortable columns exposed to the API → physical column mapping. */
  protected readonly sortable: Record<string, string> = { createdAt: 'created_at', id: 'id' };
  /** Human name used in NotFound messages. */
  protected abstract readonly entityName: string;

  constructor(protected readonly db: DatabaseService) {}

  /** Map a database row to the domain shape. */
  protected abstract toDomain(row: TRow): TDomain;

  protected tenantId(): TenantId {
    return requireTenantId();
  }

  protected op(name: string): QueryOptions {
    return { name: `${this.entityName}.${name}` };
  }

  /* ── reads ────────────────────────────────────────────────────────────*/

  async findById(id: Uuid, options: { forUpdate?: boolean; primary?: boolean } = {}): Promise<TDomain | null> {
    const lock = options.forUpdate ? ' FOR UPDATE' : '';
    const row = await this.db.queryOne<TRow>(
      `SELECT ${this.columns} FROM ${this.table}
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL${lock}`,
      [this.tenantId(), id],
      { ...this.op('findById'), primary: options.forUpdate || options.primary },
    );
    return row ? this.toDomain(row) : null;
  }

  async getById(id: Uuid, options: { forUpdate?: boolean } = {}): Promise<TDomain> {
    const found = await this.findById(id, options);
    if (!found) throw new NotFoundError(this.entityName, id);
    return found;
  }

  /** Load many by id in one round trip, preserving nothing about order. */
  async findByIds(ids: readonly Uuid[]): Promise<TDomain[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query<TRow>(
      `SELECT ${this.columns} FROM ${this.table}
        WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
      [this.tenantId(), ids],
      this.op('findByIds'),
    );
    return rows.map((row) => this.toDomain(row));
  }

  async exists(id: Uuid): Promise<boolean> {
    const row = await this.db.queryOne<{ one: number }>(
      `SELECT 1 AS one FROM ${this.table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId(), id],
      this.op('exists'),
    );
    return row !== null;
  }

  /**
   * Keyset-paginated list with optional extra predicates.
   * Over-fetches one row to detect `hasMore` without a COUNT.
   */
  protected async paginate(
    request: PageRequest,
    filters: (SqlFragment | null)[] = [],
    sortColumns: string[] = ['id'],
  ): Promise<Page<TDomain>> {
    const cursorPredicate = request.cursor
      ? keysetPredicate(sortColumns, request.cursor.k, request.direction)
      : null;

    const clause = where([
      sql`tenant_id = ${this.tenantId()}`,
      sql`deleted_at IS NULL`,
      ...filters,
      cursorPredicate,
    ]);

    const order = sortColumns
      .map((column) => `${column} ${request.direction === 'asc' ? 'ASC' : 'DESC'}`)
      .join(', ');

    const rows = await this.db.query<TRow>(
      `SELECT ${this.columns} FROM ${this.table}
       ${clause.text}
       ORDER BY ${order}
       LIMIT ${request.limit + 1}`,
      clause.params,
      this.op('paginate'),
    );

    const page = buildPage(rows, request, (row) =>
      sortColumns.map((column) => (row as Record<string, unknown>)[toCamel(column)] as string | number | null),
    );
    return { ...page, items: page.items.map((row) => this.toDomain(row)) };
  }

  /* ── writes ───────────────────────────────────────────────────────────*/

  /**
   * Optimistic-concurrency UPDATE. Returns the new version, or throws
   * `OptimisticLockError` when another writer got there first — which the unit
   * of work's caller retries.
   */
  protected async updateWithVersion(
    id: Uuid,
    expectedVersion: number,
    assignments: SqlFragment,
  ): Promise<number> {
    const clause = join([assignments], ', ');
    const row = await this.db.queryOne<{ version: number }>(
      `UPDATE ${this.table}
          SET ${clause.text}, version = version + 1, updated_at = now()
        WHERE tenant_id = $${clause.params.length + 1}
          AND id = $${clause.params.length + 2}
          AND version = $${clause.params.length + 3}
          AND deleted_at IS NULL
      RETURNING version`,
      [...clause.params, this.tenantId(), id, expectedVersion],
      { ...this.op('updateWithVersion'), primary: true },
    );
    if (!row) throw new OptimisticLockError(this.entityName, id);
    return row.version;
  }

  /**
   * Soft delete. Hard deletes are forbidden for anything with financial or
   * audit significance: a "deleted" booking must remain reconstructable for
   * seven years of tax records.
   */
  protected async softDelete(id: Uuid): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE ${this.table} SET deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId(), id],
      this.op('softDelete'),
    );
    if (affected === 0) throw new NotFoundError(this.entityName, id);
  }

  /** Advisory lock keyed on a business string — serialises a critical section. */
  protected async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hashed = hashKey(`${this.tenantId()}:${key}`);
    await this.db.query('SELECT pg_advisory_xact_lock($1)', [hashed], {
      ...this.op('advisoryLock'),
      primary: true,
    });
    return fn();
  }
}

/** 64-bit FNV-1a — stable across processes, unlike JS string hashing. */
export function hashKey(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash ^ BigInt(value.charCodeAt(i))) * prime) & mask;
  }
  // pg advisory locks take a signed bigint.
  return BigInt.asIntN(64, hash);
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
