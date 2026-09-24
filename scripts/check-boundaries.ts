/**
 * Module boundary check — a RATCHET, not a big-bang rule.
 *
 * Rule: a module may import another module only through that module's
 * public entry (`modules/<name>/index.ts`) or shared libs (@kernel, @http,
 * @database, …). Reaching into another module's domain/application/
 * infrastructure/presentation folders couples them and caused workarounds like
 * AgentLedgerModule / GdsLedgerModule.
 *
 * Existing violations are recorded in scripts/boundaries.baseline.json. The
 * check FAILS if a new violation appears, and also if one that was fixed comes
 * back — so the number can only go down. Run with --update after removing
 * violations to lower the baseline.
 *
 *   npm run check:boundaries            # CI
 *   npm run check:boundaries -- --update
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', 'apps', 'api', 'src', 'modules');
const BASELINE = join(__dirname, 'boundaries.baseline.json');
const DEEP =
  /from '((?:\.\.\/)+)([a-z-]+)\/(domain|application|infrastructure|presentation)[^']*'/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const found = new Set<string>();
for (const f of files(ROOT)) {
  const rel = relative(ROOT, f);
  const own = rel.split('/')[0];
  for (const m of readFileSync(f, 'utf8').matchAll(DEEP)) {
    if (m[2] !== own) found.add(`${rel} -> ${m[2]}/${m[3]}`);
  }
}

const baseline: string[] = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as string[])
  : [];
if (process.argv.includes('--update') || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify([...found].sort(), null, 2) + '\n');
  console.log(`baseline written: ${found.size} known cross-module deep imports`);
  process.exit(0);
}
const known = new Set(baseline);
const added = [...found].filter((v) => !known.has(v));
if (added.length) {
  console.error(
    `✖ ${added.length} NEW cross-module deep import(s) — import through the module's index.ts or a shared lib instead:`,
  );
  for (const v of added) console.error(`   ${v}`);
  process.exit(1);
}
const fixed = baseline.filter((v) => !found.has(v)).length;
console.log(
  `✓ boundaries OK — ${found.size} legacy deep imports remaining${fixed ? ` (${fixed} fixed; run with --update to lock in the progress)` : ''}`,
);
