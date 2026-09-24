import { z } from 'zod';

export const ChangeVehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  reason: z.string().trim().min(5).max(300),
});
export type ChangeVehicleDto = z.infer<typeof ChangeVehicleSchema>;
