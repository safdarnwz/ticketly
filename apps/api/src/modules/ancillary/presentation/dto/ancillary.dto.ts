import { z } from 'zod';

export const AttachAncillarySchema = z.object({
  bookingId: z.string().uuid(),
  items: z
    .array(z.object({ ancillaryId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
    .max(20),
});
export type AttachAncillaryDto = z.infer<typeof AttachAncillarySchema>;

export const UpsertAncillarySchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Letters, digits, - and _'),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['insurance', 'meal', 'luggage', 'priority', 'other']),
  /** At most ₹10,000 an add-on. */
  priceMinor: z.number().int().min(0).max(1_000_000),
  perPassenger: z.boolean().default(true),
  /** Off = no longer offered at checkout (bookings that have it keep it). */
  active: z.boolean().default(true),
});
export type UpsertAncillaryDto = z.infer<typeof UpsertAncillarySchema>;
