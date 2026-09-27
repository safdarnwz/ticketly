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
  /** A fare is at least ₹1 — zero would sell free seats. At most ₹1,00,000. */
  baseFareMinor: z.number().int().min(100, 'A fare is at least ₹1').max(10_000_000),
  perKmMinor: z.number().int().min(0).max(100_000).optional(),
});
export type AddFareRuleDto = z.infer<typeof AddFareRuleSchema>;

/**
 * Multipliers stay between 0.5× and 3× — a 0× step used to price seats at ₹0.
 * Each threshold appears once, so which step applies is never ambiguous.
 */
const multiplier = z.number().min(0.5).max(3);
const YieldLadderSchema = z
  .object({
    occupancy: z
      .array(z.object({ atPct: z.number().int().min(1).max(100), mult: multiplier }))
      .max(10),
    advancePurchase: z
      .array(z.object({ withinDays: z.number().int().min(0).max(365), mult: multiplier }))
      .max(10),
    maxMultiplier: z.number().min(1).max(3),
    minMultiplier: z.number().min(0.5).max(1),
  })
  .superRefine((l, ctx) => {
    const dup = (xs: number[]) => xs.findIndex((x, i) => xs.indexOf(x) !== i);
    const o = dup(l.occupancy.map((s) => s.atPct));
    if (o >= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['occupancy', o, 'atPct'],
        message: 'Each occupancy level once',
      });
    }
    const a = dup(l.advancePurchase.map((s) => s.withinDays));
    if (a >= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['advancePurchase', a, 'withinDays'],
        message: 'Each day count once',
      });
    }
  });

export const CreatePricingPolicySchema = z
  .object({
    /** Omit both for the operator-wide policy; a route's own policy wins over it… */
    routeId: uuid.optional(),
    /** …and one service's own policy (e.g. the 21:30 departure) wins over its route's. */
    serviceId: uuid.optional(),
    name: z.string().trim().min(1).max(120),
    ladder: YieldLadderSchema,
    // NOTE: gstRatePct deliberately removed — GST is a government-mandated
    // rate set ONLY by the platform (super admin), never per-operator. See
    // PlatformSettingsRepository.gstRatePercent / migration 0021.
  })
  .refine((p) => !(p.routeId && p.serviceId), {
    message: 'A policy is for a route or for one service, not both',
    path: ['serviceId'],
  });
export type CreatePricingPolicyDto = z.infer<typeof CreatePricingPolicySchema>;

export const CreateCouponSchema = z
  .object({
    /** Journey dates (YYYY-MM-DD) on which the coupon cannot be used, e.g. festivals. */
    blackoutDates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(366)
      .optional(),
    /** Stored upper-case; letters, digits, '-' and '_' only — what a customer can type. */
    code: z
      .string()
      .trim()
      .transform((c) => c.toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
            'Use 2–40 letters or digits (dash and underscore allowed)',
          ),
      ),
    kind: z.enum(['percent', 'flat']),
    /** Percent (1–100) or, for a flat coupon, paise (at least ₹1). */
    value: z.number().int().min(1).max(10_000_000),
    maxDiscountMinor: z.number().int().min(100).max(10_000_000).optional(),
    minFareMinor: z.number().int().min(0).max(10_000_000).optional(),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validTo: z.string().datetime({ offset: true }).optional(),
    maxRedemptions: z.number().int().min(1).max(10_000_000).optional(),
    perUserLimit: z.number().int().min(1).max(100).optional(),
    firstBookingOnly: z.boolean().optional(),
    description: z.string().max(300).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === 'percent' && c.value > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage is at most 100' });
    }
    if (c.kind === 'flat' && c.value < 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A flat discount is at least ₹1' });
    }
    if (c.kind === 'flat' && c.maxDiscountMinor !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountMinor'],
        message: 'A cap only applies to a percentage coupon',
      });
    }
    if (c.validFrom && c.validTo && Date.parse(c.validTo) <= Date.parse(c.validFrom)) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Must be after the start' });
    }
    if (c.validTo && Date.parse(c.validTo) <= Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Must be in the future' });
    }
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

/** Every seat's price on one stretch of a trip (for the seat map). */
export const SeatFaresQuerySchema = z.object({ tripId: uuid, from: uuid, to: uuid });
export type SeatFaresQueryDto = z.infer<typeof SeatFaresQuerySchema>;

/** One seat number's fare on a plan (overrides the seat-type rule for that seat). */
export const SeatFareOverrideSchema = z.object({
  seatNumber: z.string().trim().min(1).max(10),
  fareMinor: z.number().int().min(100, 'A fare is at least ₹1').max(10_000_000),
});
export type SeatFareOverrideDto = z.infer<typeof SeatFareOverrideSchema>;

export const RouteRulesSchema = z.object({
  floorMinor: z.number().int().nonnegative().nullable(),
  ceilingMinor: z.number().int().positive().nullable(),
  peakWindows: z
    .array(
      z.object({
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(0).max(1439),
        pct: z.number().min(-50).max(100),
        label: z.string().max(40).optional(),
      }),
    )
    .max(12),
});
export type RouteRulesDto = z.infer<typeof RouteRulesSchema>;

export const TripFareAdjustmentSchema = z
  .object({
    pct: z
      .number()
      .min(-50)
      .max(100)
      .refine((n) => n !== 0, 'Use null to clear')
      .nullable(),
    reason: z.string().trim().min(5).max(200).optional(),
  })
  .refine((d) => d.pct === null || !!d.reason, {
    message: 'A reason is required for a fare change',
  });
export type TripFareAdjustmentDto = z.infer<typeof TripFareAdjustmentSchema>;

/** #267 — the whole fare sheet of a plan, edited offline and sent back. */
export const ImportFareRulesSchema = z.object({
  rows: z
    .array(AddFareRuleSchema.omit({ farePlanId: true }))
    .min(1)
    .max(1000),
});
export type ImportFareRulesDto = z.infer<typeof ImportFareRulesSchema>;

/** #267 — change every fare of a plan by a percentage. */
export const AdjustFaresSchema = z.object({
  percent: z.number().min(-90).max(300),
  seatType: z.enum(['seater', 'sleeper', 'semi_sleeper']).optional(),
  /** Round results to this many paise (100 = whole rupees). */
  roundToMinor: z.number().int().min(1).max(10_000).default(100),
});
export type AdjustFaresDto = z.infer<typeof AdjustFaresSchema>;
