import { describe, expect, it } from 'vitest';

import { compareUuid, isUuidV7, newId, newIds, uuidTimestamp } from '../ids';

describe('UUID v7', () => {
  it('generates valid v7 uuids', () => {
    const id = newId();
    expect(isUuidV7(id)).toBe(true);
  });

  it('is monotonic — later ids sort after earlier ones', () => {
    const ids = newIds(1000);
    const sorted = [...ids].sort(compareUuid);
    expect(sorted).toEqual(ids);
  });

  it('embeds a recoverable creation timestamp', () => {
    const before = Date.now();
    const ts = uuidTimestamp(newId());
    expect(ts).not.toBeNull();
    expect(Math.abs((ts as Date).getTime() - before)).toBeLessThan(1000);
  });
});
