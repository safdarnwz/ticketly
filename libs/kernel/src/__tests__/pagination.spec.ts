import { describe, expect, it } from 'vitest';

import { buildPage, decodeCursor, encodeCursor, parsePageRequest } from '../pagination';

describe('keyset pagination', () => {
  it('round-trips a cursor', () => {
    const cursor = encodeCursor({ v: 1, k: ['2026-01-01', 'abc'], d: 'desc' });
    expect(decodeCursor(cursor)).toEqual({ v: 1, k: ['2026-01-01', 'abc'], d: 'desc' });
  });

  it('detects hasMore via the over-fetched row', () => {
    const request = parsePageRequest({ limit: '2' });
    const page = buildPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], request, (r) => [r.id]);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it('caps the page size', () => {
    expect(parsePageRequest({ limit: '99999' }).limit).toBeLessThanOrEqual(200);
  });

  it('rejects a malformed cursor', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow();
  });
});
