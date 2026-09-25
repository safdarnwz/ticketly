import { z } from 'zod';

import { CLEARABLE_CACHE_NAMESPACES } from '../../application/platform-cache.service';

export const ClearCacheSchema = z.object({
  /** Omit to clear every cache (idempotency keys and rate limits are never touched). */
  namespaces: z
    .array(z.enum(CLEARABLE_CACHE_NAMESPACES as [string, ...string[]]))
    .min(1)
    .optional(),
});
export type ClearCacheDto = z.infer<typeof ClearCacheSchema>;
