import { describe, expect, it } from 'vitest';

import { Permission } from '@contracts';

import { PERMISSION_CATALOGUE } from '../domain/permission-catalogue';

describe('permission catalogue', () => {
  const listed = PERMISSION_CATALOGUE.flatMap((g) => g.items.map((i) => i.code as string));

  it('lists every operator permission exactly once', () => {
    const platform = [Permission.ALL, Permission.PLATFORM_ADMIN, Permission.PLATFORM_OPERATORS];
    const operator = Object.values(Permission).filter((p) => !platform.includes(p as never));
    expect([...listed].sort()).toEqual([...operator].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('never offers a platform permission', () => {
    expect(listed).not.toContain(Permission.ALL);
    expect(listed.some((p) => p.startsWith('platform:'))).toBe(false);
  });
});
