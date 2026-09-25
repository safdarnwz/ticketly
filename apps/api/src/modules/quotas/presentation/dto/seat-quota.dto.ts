import { z } from 'zod';
import { queryFlag } from '@http';

export const AllocateQuotaSchema = z.object({
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(60),
  holderType: z.enum(['agent', 'branch']),
  holderId: z.string().uuid(),
  /** Unsold seats return to general sale this many minutes before departure (30 min – 7 days). */
  releaseMinutesBefore: z
    .number()
    .int()
    .min(30)
    .max(7 * 24 * 60),
});
export type AllocateQuotaDto = z.infer<typeof AllocateQuotaSchema>;

/** #172 — a share of the trip instead of named seats. */
export const AllocatePercentSchema = AllocateQuotaSchema.omit({ seatNumbers: true }).extend({
  percent: z.number().min(1).max(100),
});
export type AllocatePercentDto = z.infer<typeof AllocatePercentSchema>;

export const ReleaseQuotaSchema = z.object({
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(60),
  reason: z.string().trim().min(5).max(200),
});
export type ReleaseQuotaDto = z.infer<typeof ReleaseQuotaSchema>;

/** `?all=1` includes released allocations too. */
export const ListQuotasQuerySchema = z.object({ all: queryFlag });
export type ListQuotasQueryDto = z.infer<typeof ListQuotasQuerySchema>;
