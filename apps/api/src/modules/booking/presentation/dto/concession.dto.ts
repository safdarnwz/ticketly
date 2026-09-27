import { z } from 'zod';

import { CONCESSION_CATEGORIES } from '../../domain/passenger-categories';

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** One category's concession: age band, ID proof, validity window, per-booking limit. */
export const ConcessionRuleSchema = z
  .object({
    category: z.enum(CONCESSION_CATEGORIES),
    discountPct: z.number().min(0).max(100),
    minAge: z.number().int().min(0).max(120).nullable().default(null),
    maxAge: z.number().int().min(0).max(120).nullable().default(null),
    requiresIdProof: z.boolean().default(false),
    validFrom: localDate.nullable().default(null),
    validTo: localDate.nullable().default(null),
    maxPerBooking: z.number().int().min(1).max(10).nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.minAge === null || r.maxAge === null || r.minAge <= r.maxAge, {
    message: 'Minimum age cannot exceed maximum age',
  })
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, {
    message: 'Concession start date must be on or before its end date',
  });
export type ConcessionRuleDto = z.infer<typeof ConcessionRuleSchema>;

/** How far ahead sales open (null = no limit) and when they close before departure. */
export const BookingWindowSchema = z.object({
  maxAdvanceDays: z.number().int().min(1).max(365).nullable(),
  minMinutesBeforeDeparture: z.number().int().min(0).max(1440),
});
export type BookingWindowDto = z.infer<typeof BookingWindowSchema>;

/** Adult age, infant age limit and fee, and whether unaccompanied minors may book. */
export const PassengerPolicySchema = z.object({
  adultAge: z.number().int().min(12).max(21),
  infantMaxAge: z.number().int().min(1).max(6),
  infantFeeMinor: z.number().int().min(0).max(1_000_000),
  allowUnaccompaniedMinors: z.boolean(),
});
export type PassengerPolicyDto = z.infer<typeof PassengerPolicySchema>;

/** #294 — accessible seats open to everyone this many hours before departure (null = never). */
export const AccessibleSeatRuleSchema = z.object({
  releaseHours: z.number().int().min(0).max(720).nullable(),
});
export type AccessibleSeatRuleDto = z.infer<typeof AccessibleSeatRuleSchema>;

/** Round-trip discount (#283): % off the return journey, 0–50 (0 = none). */
export const RoundTripRuleSchema = z.object({
  discountPct: z.number().int().min(0).max(50),
});
export type RoundTripRuleDto = z.infer<typeof RoundTripRuleSchema>;

/** Checkout: the journey date decides which dated concessions apply. */
export const CheckoutConcessionQuerySchema = z.object({
  journeyDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .optional(),
});
export type CheckoutConcessionQueryDto = z.infer<typeof CheckoutConcessionQuerySchema>;
