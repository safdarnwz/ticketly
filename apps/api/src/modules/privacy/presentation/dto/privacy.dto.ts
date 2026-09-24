import { z } from 'zod';
import { ERASURE_STATUSES } from '../../domain/erasure-request';

export const ConsentSchema = z.object({
  purpose: z.enum([
    'transactional',
    'marketing',
    'personalization',
    'analytics',
    'third_party_share',
  ]),
  granted: z.boolean(),
});
export type ConsentDto = z.infer<typeof ConsentSchema>;

export const ListErasureRequestsQuerySchema = z.object({
  status: z.enum(ERASURE_STATUSES).optional(),
});
export type ListErasureRequestsQueryDto = z.infer<typeof ListErasureRequestsQuerySchema>;
