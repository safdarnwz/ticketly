import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

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
const GUARDED_CONTROLLERS = [
  'apps/api/src/modules/booking/booking.controller.ts',
  'apps/api/src/modules/payment/payment.controller.ts',
  'apps/api/src/modules/distribution/distribution.controller.ts',
];

// Handlers that legitimately don't need the Idempotency-Key header:
//  - reads (search/quote return data, mutate nothing)
//  - the webhook (idempotency is the PSP event-id dedupe, not the header)
//  - admin config (setCommission) and settlement ops (internally idempotent on
//    status), which are operator-triggered and not double-charge risks.
// The genuine double-charge/double-book surfaces — hold, confirm, cancel,
// intent — are NOT exempt and must carry @Idempotent().
const EXEMPT = new Set([
  'webhook', 'catalogue', 'byPnr', 'trialBalance',
  'search_', 'quote', 'setCommission', 'generateSettlement', 'finaliseSettlement',
]);

describe('architecture: idempotency on money/inventory endpoints', () => {
  for (const file of GUARDED_CONTROLLERS) {
    it(`${file} — every mutating handler is @Idempotent()`, () => {
      const source = readFileSync(file, 'utf8');
      // Find each @Post(...) handler and check the decorator block above it.
      const blocks = source.split(/\n\s*@(?:Post|Put|Patch|Delete)\(/).slice(1);
      const violations: string[] = [];
      for (const block of blocks) {
        const nameMatch = /async\s+(\w+)\s*\(/.exec(block);
        const name = nameMatch?.[1] ?? 'unknown';
        if (EXEMPT.has(name)) continue;
        // The decorator block is everything before the `async name(`.
        const head = block.split(/async\s+\w+\s*\(/)[0];
        if (!head.includes('@Idempotent()')) violations.push(name);
      }
      expect(violations, `Missing @Idempotent() on: ${violations.join(', ')}`).toEqual([]);
    });
  }
});
