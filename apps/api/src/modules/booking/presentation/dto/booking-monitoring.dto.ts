import { z } from 'zod';

import { localDateQuery } from '@http';

/** Longest period one request may cover (the feed pages; the summary groups). */
export const MONITORING_MAX_DAYS = 92;

const period = {
  /** Calendar dates in the platform's time zone; both default to today. */
  from: localDateQuery.optional(),
  to: localDateQuery.optional(),
};

export const BookingFeedQuerySchema = z.object({
  ...period,
  tenantId: z.string().uuid().optional(),
  status: z.enum(['all', 'live', 'confirmed', 'cancelled', 'expired', 'completed']).default('all'),
  channel: z.enum(['direct_web', 'direct_app', 'ota', 'backoffice']).optional(),
  pnr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,12}$/, 'A PNR is 4–12 letters and digits')
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type BookingFeedQuery = z.infer<typeof BookingFeedQuerySchema>;

export const BookingActivityQuerySchema = z.object(period);
export type BookingActivityQuery = z.infer<typeof BookingActivityQuerySchema>;
