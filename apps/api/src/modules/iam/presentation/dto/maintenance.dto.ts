import { z } from 'zod';

import { queryFlag } from '@http';

export const MaintenanceModeSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
  /** Expected end, ISO date-time — shown to users and used for Retry-After. */
  until: z.string().datetime({ offset: true }).optional(),
});
export type MaintenanceModeDto = z.infer<typeof MaintenanceModeSchema>;

/** #109 — a future maintenance window (ISO date-times with offset). */
export const ScheduleMaintenanceSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  message: z.string().trim().max(300).default(''),
  /** #110 — email every active operator now. */
  notifyOperators: z.boolean().default(false),
});
export type ScheduleMaintenanceDto = z.infer<typeof ScheduleMaintenanceSchema>;

export const MaintenanceWindowListQuerySchema = z.object({ includePast: queryFlag });
export type MaintenanceWindowListQueryDto = z.infer<typeof MaintenanceWindowListQuerySchema>;
