import { BadRequestError } from './errors';

/**
 * ============================================================================
 *  Keyset (cursor) pagination
 * ============================================================================
 *
 * OFFSET pagination is banned in this codebase for any list that can grow.
 * `OFFSET 500000` forces Postgres to read and discard 500k rows — latency grows
 * linearly with page number, and rows shift under the user between pages.
 *
 * Keyset pagination is O(log n) forever:
 *
 *   SELECT ... FROM bookings
 *   WHERE tenant_id = $1 AND (created_at, id) < ($cursorTs, $cursorId)
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT $pageSize + 1;
 *
 * The `+ 1` row is the has-more probe and is stripped before returning.
 * Because our PKs are UUID v7 (time-ordered), a single `id` column is usually
 * a sufficient sort key — see `ids.ts`.
 *
 * Cursors are opaque base64url of a JSON payload plus a version tag, so the
 * shape can evolve without breaking clients holding old cursors.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface CursorPayload {
  /** Cursor format version — bump when the sort key changes. */
  v: number;
  /** Sort key values, in sort order. */
  k: (string | number | null)[];
  /** Direction the cursor was minted for; guards against mixing. */
  d: 'asc' | 'desc';
}

export interface PageRequest {
  limit: number;
  cursor?: CursorPayload;
  direction: 'asc' | 'desc';
}

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
  /**
   * Total count is intentionally optional and off by default: an exact
   * `COUNT(*)` on a large partitioned table costs more than the page itself.
   * Endpoints that truly need it opt in and pay for it explicitly.
   */
  totalCount?: number;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined | null): CursorPayload | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof parsed?.v !== 'number' || !Array.isArray(parsed.k)) {
      throw new Error('malformed');
    }
    return parsed;
  } catch {
    throw new BadRequestError('Invalid pagination cursor', { details: { param: 'cursor' } });
  }
}

export function parsePageRequest(input: {
  limit?: number | string;
  cursor?: string;
  direction?: string;
}): PageRequest {
  const rawLimit = input.limit === undefined ? DEFAULT_PAGE_SIZE : Number(input.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new BadRequestError('limit must be a positive integer', { details: { param: 'limit' } });
  }
  const direction = input.direction === 'asc' ? 'asc' : 'desc';
  const cursor = decodeCursor(input.cursor);
  if (cursor && cursor.d !== direction) {
    throw new BadRequestError('Cursor direction does not match requested direction');
  }
  return { limit: Math.min(rawLimit, MAX_PAGE_SIZE), cursor, direction };
}

/**
 * Build a `Page<T>` from an over-fetched row set.
 * `rows` must contain up to `limit + 1` items.
 */
export function buildPage<T>(
  rows: T[],
  request: PageRequest,
  keyOf: (row: T) => (string | number | null)[],
  cursorVersion = 1,
): Page<T> {
  const hasMore = rows.length > request.limit;
  const items = hasMore ? rows.slice(0, request.limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ v: cursorVersion, k: keyOf(last), d: request.direction })
        : null,
  };
}

export function emptyPage<T>(): Page<T> {
  return { items: [], nextCursor: null, hasMore: false };
}

/** Map a page's items while preserving cursor metadata. */
export function mapPage<T, U>(page: Page<T>, fn: (item: T) => U): Page<U> {
  return { ...page, items: page.items.map(fn) };
}
