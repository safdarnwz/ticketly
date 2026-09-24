import { z } from 'zod';

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number');

export const JoinDemandListSchema = z.object({
  fromStopId: z.string().uuid(),
  toStopId: z.string().uuid(),
  seatCount: z.number().int().min(1).max(6),
  contactPhone: phone,
  contactEmail: z.string().trim().email().optional(),
});
export type JoinDemandListDto = z.infer<typeof JoinDemandListSchema>;

export const LeaveDemandListSchema = z.object({ contactPhone: phone });
export type LeaveDemandListDto = z.infer<typeof LeaveDemandListSchema>;

export const ForecastQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(7),
});
export type ForecastQueryDto = z.infer<typeof ForecastQuerySchema>;
