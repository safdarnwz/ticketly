import { z } from 'zod';

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(160),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  managerUserId: z.string().uuid().optional(),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial();
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;
