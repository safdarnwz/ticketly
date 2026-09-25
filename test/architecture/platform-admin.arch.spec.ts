import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architecture test — every `admin/...` route is platform-admin only.
 *
 * A permission check alone is not enough on a platform route: an operator's
 * `owner` role holds the `*` wildcard within its own tenant, and `*`
 * satisfies any permission. `@RequirePlatformAdmin()` (on the class or the
 * handler) adds "and the caller is Ticketly's own staff, not a tenant".
 */
const ROOT = 'apps/api/src/modules';

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : controllers(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

function unguardedAdminRoutes(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const [header, ...rest] = src.split('export class');
  if (header.includes('@RequirePlatformAdmin()') || rest.length === 0) return [];
  const base = /@Controller\(\{ path: '([^']*)'/.exec(header)?.[1] ?? '';
  const handlers = rest.join('export class').split(/\n {2}@(?=(?:Get|Post|Put|Patch|Delete)\()/);
  return handlers.slice(1).flatMap((h) => {
    const m = /^(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/.exec(h);
    if (!m) return [];
    const path = [base, m[2] ?? ''].filter(Boolean).join('/');
    const decorators = h.split(/\n {2}(?:async )?\w+\(/)[0];
    const isAdmin = path.startsWith('admin') || path.includes('/admin');
    return isAdmin && !decorators.includes('@RequirePlatformAdmin()')
      ? [`${relative(ROOT, file)}: ${m[1].toUpperCase()} /${path}`]
      : [];
  });
}

describe('architecture: admin routes are platform-admin only', () => {
  it('every admin/... handler carries @RequirePlatformAdmin()', () => {
    expect(controllers(ROOT).flatMap(unguardedAdminRoutes)).toEqual([]);
  });
});
