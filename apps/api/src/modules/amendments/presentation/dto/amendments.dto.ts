import { z } from 'zod';

const uuid = z.string().uuid();

export const RescheduleSchema = z.object({
  newTripId: uuid,
  newFromStopId: uuid,
  newToStopId: uuid,
  newSeatNumbers: z.array(z.string().min(1)).min(1).max(10),
});
export type RescheduleDto = z.infer<typeof RescheduleSchema>;

export const SeatChangeSchema = z.object({
  newSeatNumbers: z.array(z.string().min(1)).min(1).max(10),
});
export type SeatChangeDto = z.infer<typeof SeatChangeSchema>;
