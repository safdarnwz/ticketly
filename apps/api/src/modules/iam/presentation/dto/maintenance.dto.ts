import { z } from 'zod';

export const MaintenanceModeSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
  /** Expected end, ISO date-time — shown to users and used for Retry-After. */
  until: z.string().datetime({ offset: true }).optional(),
});
export type MaintenanceModeDto = z.infer<typeof MaintenanceModeSchema>;
