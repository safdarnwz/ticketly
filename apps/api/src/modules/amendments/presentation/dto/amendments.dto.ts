import { z } from 'zod';

const uuid = z.string().uuid();

export const RescheduleSchema = z.object({
  newTripId: uuid,
  newFromStopId: uuid,
  newToStopId: uuid,
  newSeatNumbers: z.array(z.string().trim().min(1)).min(1).max(10),
});
export type RescheduleDto = z.infer<typeof RescheduleSchema>;

export const SeatChangeSchema = z.object({
  newSeatNumbers: z.array(z.string().trim().min(1)).min(1).max(10),
});
export type SeatChangeDto = z.infer<typeof SeatChangeSchema>;

export const NameCorrectionSchema = z.object({
  seatNumber: z.string().trim().min(1),
  fullName: z.string().trim().min(2).max(120),
});
export type NameCorrectionDto = z.infer<typeof NameCorrectionSchema>;

export const PointChangeSchema = z
  .object({ fromStopId: z.string().uuid().optional(), toStopId: z.string().uuid().optional() })
  .refine((d) => d.fromStopId || d.toStopId, {
    message: 'Choose a new boarding and/or dropping point',
  });
export type PointChangeDto = z.infer<typeof PointChangeSchema>;
