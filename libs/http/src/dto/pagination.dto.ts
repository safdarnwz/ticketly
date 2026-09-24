import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kernel';

/**
 * Shared query schema for every paginated collection endpoint.
 * Feature modules extend it: `PaginationQuerySchema.extend({ status: ... })`.
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(2048).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** OpenAPI schema for a page envelope of `T`. */
export function pageSchema(itemRef: string): Record<string, unknown> {
  return {
    type: 'object',
    required: ['items', 'hasMore', 'nextCursor'],
    properties: {
      items: { type: 'array', items: { $ref: itemRef } },
      hasMore: { type: 'boolean' },
      nextCursor: { type: 'string', nullable: true, description: 'Pass as ?cursor= to fetch the next page' },
      totalCount: { type: 'integer', nullable: true, description: 'Only present when explicitly requested' },
    },
  };
}
