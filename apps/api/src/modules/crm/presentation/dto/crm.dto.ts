import { z } from 'zod';

export const BlockCustomerSchema = z.object({
  reason: z.string().trim().min(5, 'Say why, in a few words').max(500),
});
export type BlockCustomerDto = z.infer<typeof BlockCustomerSchema>;

export const CustomerListQuerySchema = z.object({
  /** Name (part), mobile (part, 4+ digits), exact email, or a PNR. */
  q: z.string().trim().max(80).optional(),
  filter: z.enum(['all', 'frequent', 'blocked']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CustomerListQueryDto = z.infer<typeof CustomerListQuerySchema>;
