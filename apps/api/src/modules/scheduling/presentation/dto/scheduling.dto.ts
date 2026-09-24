import { z } from 'zod';

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const RecurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  interval: z.number().int().min(1).max(52).optional(),
  startDate: localDate,
  endDate: localDate,
  exceptions: z.array(localDate).optional(),
  additions: z.array(localDate).optional(),
});

export const CreateServiceSchema = z.object({
  code: z.string().min(1).max(40),
  routeId: uuid,
  vehicleTypeId: uuid,
  defaultVehicleId: uuid.optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  recurrence: RecurrenceSchema,
});
export type CreateServiceDto = z.infer<typeof CreateServiceSchema>;

export const PreviewDatesSchema = z.object({
  recurrence: RecurrenceSchema,
  from: localDate,
  to: localDate,
});
export type PreviewDatesDto = z.infer<typeof PreviewDatesSchema>;

export const BlockSeatsSchema = z.object({
  seatNumbers: z.array(z.string().min(1)).min(1),
  fromStopId: uuid,
  toStopId: uuid,
  block: z.boolean().default(true),
});
export type BlockSeatsDto = z.infer<typeof BlockSeatsSchema>;

export const ExtraTripsSchema = z.object({
  journeyDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(31),
  departureTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')
    .optional(),
  vehicleId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(200),
  openForSale: z.boolean().optional(),
  ladiesSpecial: z.boolean().optional(),
  allowOverlap: z.boolean().optional(),
});
export type ExtraTripsDto = z.infer<typeof ExtraTripsSchema>;

export const ReleaseHoldsSchema = z.object({ includePhoneHolds: z.boolean().default(false) });
export type ReleaseHoldsDto = z.infer<typeof ReleaseHoldsSchema>;

/** An internal (staff-only) remark on a trip. */
export const TripRemarkSchema = z.object({ remark: z.string().trim().min(2).max(1000) });
export type TripRemarkDto = z.infer<typeof TripRemarkSchema>;
