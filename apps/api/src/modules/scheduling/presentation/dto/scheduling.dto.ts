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

const categoryQuota = z.object({
  seats: z.number().int().min(1).max(100).optional(),
  pct: z.number().min(1).max(100).optional(),
  releaseHours: z.number().int().min(0).max(720),
});

/** #170 / #173 / #174 — OTA release and women / senior seat quotas of a service. */
export const SalesRulesSchema = z.object({
  /** null or omitted = the platform default. */
  otaReleasePct: z.number().int().min(0).max(100).nullable().optional(),
  categoryQuotas: z
    .object({ female: categoryQuota.optional(), senior: categoryQuota.optional() })
    .optional(),
});
export type SalesRulesDto = z.infer<typeof SalesRulesSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

/** #269 — change a service's timetable; every change is kept as a version. */
export const UpdateTimetableSchema = z
  .object({
    startTime: hhmm.optional(),
    recurrence: RecurrenceSchema.optional(),
    vehicleTypeId: uuid.optional(),
    defaultVehicleId: uuid.nullable().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine(
    (v) =>
      v.startTime !== undefined ||
      v.recurrence !== undefined ||
      v.vehicleTypeId !== undefined ||
      v.defaultVehicleId !== undefined,
    { message: 'Change at least one of startTime, recurrence, vehicleTypeId, defaultVehicleId' },
  );
export type UpdateTimetableDto = z.infer<typeof UpdateTimetableSchema>;

/** #266 / #272 — copy a service to other dates, optionally as a seasonal variant. */
export const CloneServiceSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    startDate: localDate,
    endDate: localDate,
    startTime: hhmm.optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    /** The original skips these dates, so the two never run on the same day. */
    season: z.boolean().default(false),
  })
  .refine((v) => v.startDate <= v.endDate, { message: 'startDate must not be after endDate' });
export type CloneServiceDto = z.infer<typeof CloneServiceSchema>;

/** #275 — move one trip; its passengers are told. */
export const RetimeTripSchema = z.object({
  newDepartsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(200),
});
export type RetimeTripDto = z.infer<typeof RetimeTripSchema>;

/** #271 — dates a route does not run. */
export const BlackoutSchema = z.object({
  dates: z.array(localDate).min(1).max(60),
  reason: z.string().trim().min(3).max(200),
});
export type BlackoutDto = z.infer<typeof BlackoutSchema>;

export const RemoveBlackoutSchema = BlackoutSchema.pick({ dates: true });
export type RemoveBlackoutDto = z.infer<typeof RemoveBlackoutSchema>;
