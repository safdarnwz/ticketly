import { BadRequestError, chunk } from '@kernel';

/**
 * ============================================================================
 *  SQL composition helpers
 * ============================================================================
 *
 * We write SQL by hand. No ORM sits between the developer and the query plan.
 *
 * WHY, given "easy feature development" is a goal:
 *  - The hot paths in this system (segment availability, search, seat maps) are
 *    hand-tuned queries with CTEs, lateral joins, partial indexes and bitmap
 *    operations. Every ORM either cannot express them or emits a plan that is
 *    10-100x slower.
 *  - An ORM's N+1 behaviour is invisible until production. Explicit SQL makes
 *    every round trip visible in review.
 *  - Migrations stay honest: the schema is the source of truth, not a
 *    decorator soup that drifts from it.
 *
 * What we DO provide is composition safety: a fragment type that carries its
 * own parameters, so building a dynamic WHERE clause can never interpolate a
 * value into the query text.
 */

export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

/**
 * Tagged template producing a parameterised fragment.
 *
 *   const f = sql`status = ${status} AND tenant_id = ${tenantId}`;
 *   // f.text === 'status = $1 AND tenant_id = $2'
 *
 * Interpolating another fragment splices it and renumbers the placeholders.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  const parts: string[] = [];
  const params: unknown[] = [];

  strings.forEach((literal, index) => {
    parts.push(literal);
    if (index >= values.length) return;

    const value = values[index];
    if (isFragment(value)) {
      // Splice a nested fragment, offsetting its placeholder numbers.
      parts.push(renumber(value.text, params.length));
      params.push(...value.params);
    } else if (value instanceof SqlRaw) {
      parts.push(value.text);
    } else {
      params.push(value);
      parts.push(`$${params.length}`);
    }
  });

  return { text: parts.join(''), params };
}

/**
 * Escape hatch for *identifiers and keywords only* — never for values.
 * Callers must pass a value from a closed allow-list; the constructor enforces
 * a conservative character set as a second line of defence.
 */
export class SqlRaw {
  constructor(readonly text: string) {
    if (!/^[A-Za-z0-9_.,\s"()*]+$/.test(text)) {
      throw new BadRequestError('Unsafe raw SQL fragment rejected');
    }
  }
}

export function raw(text: string): SqlRaw {
  return new SqlRaw(text);
}

/** Validate a sort column against an allow-list and render `col ASC|DESC`. */
export function orderBy(
  column: string,
  direction: 'asc' | 'desc',
  allowed: Record<string, string>,
): SqlRaw {
  const mapped = allowed[column];
  if (!mapped) {
    throw new BadRequestError(`Cannot sort by '${column}'`, {
      details: { allowed: Object.keys(allowed) },
    });
  }
  return new SqlRaw(`${mapped} ${direction === 'asc' ? 'ASC' : 'DESC'}`);
}

export function isFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SqlFragment).text === 'string' &&
    Array.isArray((value as SqlFragment).params)
  );
}

/** Join fragments with a separator, skipping empties. */
export function join(fragments: (SqlFragment | null | undefined)[], separator = ' AND '): SqlFragment {
  const present = fragments.filter((f): f is SqlFragment => !!f && f.text.trim() !== '');
  if (present.length === 0) return { text: '', params: [] };

  const parts: string[] = [];
  const params: unknown[] = [];
  for (const fragment of present) {
    parts.push(renumber(fragment.text, params.length));
    params.push(...fragment.params);
  }
  return { text: parts.join(separator), params };
}

/** `WHERE a AND b` — or nothing at all when no conditions apply. */
export function where(conditions: (SqlFragment | null | undefined)[]): SqlFragment {
  const joined = join(conditions, ' AND ');
  return joined.text ? { text: `WHERE ${joined.text}`, params: joined.params } : joined;
}

/**
 * Build a multi-row INSERT. One statement for N rows instead of N statements
 * turns a 500-row seat-inventory materialisation from ~250ms into ~4ms.
 * Batches are capped so the parameter count stays under Postgres' 65535 limit.
 */
export function bulkInsert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  columns: (keyof T & string)[],
  options: { onConflict?: string; returning?: string; batchSize?: number } = {},
): SqlFragment[] {
  if (rows.length === 0) return [];

  const maxRowsPerBatch = Math.min(
    options.batchSize ?? 1_000,
    Math.floor(65_000 / columns.length),
  );

  return chunk(rows, maxRowsPerBatch).map((batch) => {
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(',')})`;
    });

    const text =
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}` +
      (options.onConflict ? ` ${options.onConflict}` : '') +
      (options.returning ? ` RETURNING ${options.returning}` : '');

    return { text, params };
  });
}

/**
 * Keyset predicate for `(a, b) < ($1, $2)` style pagination.
 * Row-value comparison is important: it is a single index range scan, whereas
 * `a < $1 OR (a = $1 AND b < $2)` frequently degrades into a bitmap OR.
 */
export function keysetPredicate(
  columns: string[],
  values: readonly unknown[],
  direction: 'asc' | 'desc',
): SqlFragment | null {
  if (values.length === 0) return null;
  if (columns.length !== values.length) {
    throw new BadRequestError('Cursor does not match the sort key of this endpoint');
  }
  const params = [...values];
  const placeholders = params.map((_, index) => `$${index + 1}`);
  const operator = direction === 'asc' ? '>' : '<';
  return {
    text: `(${columns.join(',')}) ${operator} (${placeholders.join(',')})`,
    params,
  };
}

/** `col = ANY($1)` — one parameter instead of N, and it uses the index. */
export function anyOf(column: string, values: readonly unknown[]): SqlFragment {
  return { text: `${column} = ANY($1)`, params: [values] };
}

function renumber(text: string, offset: number): string {
  if (offset === 0) return text;
  return text.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
}
