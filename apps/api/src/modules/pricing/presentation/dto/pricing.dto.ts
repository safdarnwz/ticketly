import { z } from 'zod';

const uuid = z.string().uuid();

export const CreateFarePlanSchema = z.object({
  routeId: uuid,
  name: z.string().min(1).max(120),
  currency: z.enum(['INR', 'USD', 'AED', 'LKR', 'NPR', 'BDT']).default('INR'),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Weekend / weekday tariff: ISO weekdays 1 (Mon) … 7 (Sun). Omit for every day. */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
});
export type CreateFarePlanDto = z.infer<typeof CreateFarePlanSchema>;

export const AddFareRuleSchema = z.object({
  farePlanId: uuid,
  fromStopId: uuid.optional(),
  toStopId: uuid.optional(),
  seatType: z.enum(['seater', 'sleeper', 'semi_sleeper']).default('seater'),
  baseFareMinor: z.number().int().min(0),
  perKmMinor: z.number().int().min(0).optional(),
});
export type AddFareRuleDto = z.infer<typeof AddFareRuleSchema>;

const YieldLadderSchema = z.object({
  occupancy: z.array(
    z.object({ atPct: z.number().min(0).max(100), mult: z.number().min(0).max(10) }),
  ),
  advancePurchase: z.array(
    z.object({ withinDays: z.number().int().min(0), mult: z.number().min(0).max(10) }),
  ),
  maxMultiplier: z.number().min(1).max(10),
  minMultiplier: z.number().min(0).max(1),
});

export const CreatePricingPolicySchema = z.object({
  routeId: uuid.optional(),
  name: z.string().min(1).max(120),
  ladder: YieldLadderSchema,
  // NOTE: gstRatePct deliberately removed — GST is a government-mandated
  // rate set ONLY by the platform (super admin), never per-operator. See
  // PlatformSettingsRepository.gstRatePercent / migration 0021.
});
export type CreatePricingPolicyDto = z.infer<typeof CreatePricingPolicySchema>;

export const CreateCouponSchema = z.object({
  /** Journey dates (YYYY-MM-DD) on which the coupon cannot be used, e.g. festivals. */
  blackoutDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(366)
    .optional(),
  code: z.string().min(2).max(40),
  kind: z.enum(['percent', 'flat']),
  value: z.number().int().min(0),
  maxDiscountMinor: z.number().int().min(0).optional(),
  minFareMinor: z.number().int().min(0).optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  maxRedemptions: z.number().int().min(1).optional(),
  perUserLimit: z.number().int().min(1).optional(),
  firstBookingOnly: z.boolean().optional(),
  description: z.string().max(300).optional(),
});
export type CreateCouponDto = z.infer<typeof CreateCouponSchema>;

export const QuoteSchema = z
  .object({
    tripId: uuid,
    fromStopId: uuid,
    toStopId: uuid,
    seatType: z.enum(['seater', 'sleeper', 'semi_sleeper']).default('seater'),
    /** Preferred — enables per-seat-number fare overrides + an accurate per-seat breakdown. */
    seatNumbers: z.array(z.string().min(1)).min(1).max(10).optional(),
    /** Fallback when no seat map is available yet. One of seatNumbers/seatCount is required. */
    seatCount: z.number().int().min(1).max(10).optional(),
    couponCode: z.string().max(40).optional(),
  })
  .refine((v) => (v.seatNumbers && v.seatNumbers.length > 0) || (v.seatCount && v.seatCount > 0), {
    message: 'seatNumbers or seatCount is required',
    path: ['seatNumbers'],
  });
export type QuoteDto = z.infer<typeof QuoteSchema>;

export const SearchSchema = z.object({
  originCityId: uuid,
  destCityId: uuid,
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seatType: z.enum(['seater', 'sleeper', 'semi_sleeper']).optional(),
  fromStopId: uuid.optional(),
  toStopId: uuid.optional(),
});
export type SearchDto = z.infer<typeof SearchSchema>;
