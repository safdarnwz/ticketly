import { z } from 'zod';

import { WEEKDAYS } from '../../domain/working-hours';

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(160),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  managerUserId: z.string().uuid().optional(),
  /** #129 — per weekday; null or missing = closed that day. */
  workingHours: z
    .record(z.enum(WEEKDAYS), z.object({ open: z.string(), close: z.string() }).nullable())
    .optional(),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial();
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;
