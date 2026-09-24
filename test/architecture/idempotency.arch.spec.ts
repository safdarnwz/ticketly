import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Architecture test — build-time enforcement of a platform invariant.
 *
 * Every controller handler that creates a booking, moves money, or otherwise
 * consumes inventory MUST be `@Idempotent()`. A retried request on a flaky
 * connection must never double-book or double-charge. Rather than rely on code
 * review to catch a missing decorator, this test scans the money/inventory
 * controllers and FAILS THE BUILD if a mutating handler lacks `@Idempotent()`.
 *
 * This is how the "one forgotten decorator = a duplicate charge" class of bug is
 * made impossible to merge.
 */
const GUARDED_MODULES = ['booking', 'payment', 'distribution', 'gds', 'agents', 'connections'];
const GUARDED_CONTROLLERS = GUARDED_MODULES.flatMap((m) => {
  const dir = join('apps/api/src/modules', m, 'presentation');
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.controller.ts') || f.endsWith('.controllers.ts')).map((f) => join(dir, f));
  } catch {
    return []; // module merged away / renamed — nothing to scan
  }
});

// Only POST handlers are checked: PUT / PATCH / DELETE are idempotent by HTTP
// semantics (replaying "set X to Y" or "delete X" changes nothing).
//
// POST handlers that legitimately don't need the Idempotency-Key header:
//  - reads over POST (search/quote return data, mutate nothing)
//  - the payment webhook (idempotency is the PSP event-id dedupe)
//  - admin config / state switches, where a replay sets the same state again
//    and no money or seat moves: commission config, settlement ops (internally
//    idempotent on status), stop/resume sales, no-show flag, partner/agent
//    status, partner webhook registration, partner API key issue.
// The genuine double-charge/double-book surfaces — hold, extend-hold, confirm,
// cancel, intent, receipts — are NOT exempt and must carry @Idempotent().
const EXEMPT = new Set([
  'webhook', 'catalogue', 'byPnr', 'trialBalance',
  'search', 'search_', 'quote', 'setCommission', 'generateSettlement', 'finaliseSettlement',
  'stopSales', 'resumeSales', 'markNoShow', 'status', 'setStatus', 'registerWebhook', 'issueKey',
]);

/** The handler name: the first line after the route decorator that is a method signature. */
function handlerName(block: string): string {
  for (const line of block.split('\n')) {
    const m = /^\s*(?:async\s+)?(\w+)\s*\(/.exec(line);
    if (m && !line.trim().startsWith('@')) return m[1]!;
  }
  return 'unknown';
}

describe('architecture: idempotency on money/inventory endpoints', () => {
  it('finds the controllers it guards', () => expect(GUARDED_CONTROLLERS.length).toBeGreaterThan(3));

  for (const file of GUARDED_CONTROLLERS) {
    it(`${file} — every mutating handler is @Idempotent()`, () => {
      const source = readFileSync(file, 'utf8');
      // Find each @Post(...) handler and check the decorator block above it.
      const blocks = source.split(/\n\s*@Post\(/).slice(1);
      const violations: string[] = [];
      for (const block of blocks) {
        const name = handlerName(block);
        if (EXEMPT.has(name)) continue;
        // The decorator block is everything before the `async name(`.
        const head = block.slice(0, block.indexOf(`${name}(`));
        if (!head.includes('@Idempotent()')) violations.push(name);
      }
      expect(violations, `Missing @Idempotent() on: ${violations.join(', ')}`).toEqual([]);
    });
  }
});
