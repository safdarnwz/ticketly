import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architecture test — SQL lives in repositories.
 *
 * Every query belongs in a module's `infrastructure/` folder (repositories,
 * stores). Application services hold the rules, controllers only translate
 * HTTP; neither talks to the database directly. This test fails the build if
 * a SQL statement (or a raw `client.query`) appears anywhere else.
 */
const ROOT = 'apps/api/src/modules';
const SQL = /`[^`]*\b(SELECT\s[^`]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/;
const RAW_QUERY = /\bclient\.query\s*[<(]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === '__tests__' || name === 'infrastructure' ? [] : files(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture: SQL only in infrastructure/', () => {
  it('no application, domain or presentation file contains SQL', () => {
    const offenders = files(ROOT)
      .filter((f) => {
        const code = readFileSync(f, 'utf8');
        return SQL.test(code) || RAW_QUERY.test(code);
      })
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
