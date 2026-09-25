import { z } from 'zod';

export const AttachAncillarySchema = z.object({
  bookingId: z.string().uuid(),
  items: z
    .array(z.object({ ancillaryId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
    .max(20),
});
export type AttachAncillaryDto = z.infer<typeof AttachAncillarySchema>;

export const UpsertAncillarySchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  kind: z.enum(['insurance', 'meal', 'luggage', 'priority', 'other']),
  priceMinor: z.number().int().min(0),
  perPassenger: z.boolean().default(true),
});
export type UpsertAncillaryDto = z.infer<typeof UpsertAncillarySchema>;
