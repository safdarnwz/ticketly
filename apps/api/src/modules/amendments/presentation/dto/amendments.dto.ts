import { z } from 'zod';

const uuid = z.string().uuid();
/** The customer's proof when not signed in: the mobile the booking was made with. */
const mobile = z.string().trim().max(20).optional();

export const RescheduleSchema = z.object({
  newTripId: uuid,
  newFromStopId: uuid,
  newToStopId: uuid,
  newSeatNumbers: z.array(z.string().trim().min(1)).min(1).max(10),
  mobile,
});
export type RescheduleDto = z.infer<typeof RescheduleSchema>;

/** Buses on one day (YYYY-MM-DD) this booking could move to. */
export const RescheduleOptionsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  mobile,
});
export type RescheduleOptionsQueryDto = z.infer<typeof RescheduleOptionsQuerySchema>;

/** What a date / trip change would cost now (seats as a comma-separated list). */
export const RescheduleQuoteQuerySchema = z.object({
  newTripId: uuid,
  newFromStopId: uuid,
  newToStopId: uuid,
  seats: z
    .string()
    .trim()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1)).min(1).max(10)),
  mobile,
});
export type RescheduleQuoteQueryDto = z.infer<typeof RescheduleQuoteQuerySchema>;

export const SeatChangeSchema = z.object({
  newSeatNumbers: z.array(z.string().trim().min(1)).min(1).max(10),
  mobile,
});
export type SeatChangeDto = z.infer<typeof SeatChangeSchema>;

export const NameCorrectionSchema = z.object({
  seatNumber: z.string().trim().min(1),
  fullName: z.string().trim().min(2).max(120),
  mobile,
});
export type NameCorrectionDto = z.infer<typeof NameCorrectionSchema>;

export const PointChangeSchema = z
  .object({
    fromStopId: z.string().uuid().optional(),
    toStopId: z.string().uuid().optional(),
    mobile,
  })
  .refine((d) => d.fromStopId || d.toStopId, {
    message: 'Choose a new boarding and/or dropping point',
  });
export type PointChangeDto = z.infer<typeof PointChangeSchema>;
