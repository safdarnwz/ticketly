import { z } from 'zod';

import { ALLOWED_GST_RATES } from '../../../platform-settings';

const featureKey = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/, 'letters, digits and _ (2–41 chars)');
const gstRate = z
  .number()
  .refine((v) => (ALLOWED_GST_RATES as readonly number[]).includes(v), 'not a GST rate');
const reason = z.string().trim().min(3).max(500);

export const FeatureKeySchema = featureKey;

export const PlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
  name: z.string().trim().min(2).max(80),
  monthlyPrice: z.number().int().nonnegative(),
  currency: z.string().length(3).default('INR'),
  features: z.record(featureKey, z.boolean()).default({}),
  quotas: z.record(featureKey, z.number().int().nonnegative().nullable()).default({}),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type PlanDto = z.infer<typeof PlanSchema>;

export const SetPlanActiveSchema = z.object({ isActive: z.boolean() });
export type SetPlanActiveDto = z.infer<typeof SetPlanActiveSchema>;

export const ChangePlanSchema = z.object({ planId: z.string().uuid() });
export type ChangePlanDto = z.infer<typeof ChangePlanSchema>;

/** true = on, false = off, null = follow the plan. */
export const SetFeatureSchema = z.object({ enabled: z.boolean().nullable() });
export type SetFeatureDto = z.infer<typeof SetFeatureSchema>;

/** Platform-wide monetisation defaults; only the fields sent are changed. */
export const PlatformSettingsSchema = z
  .object({
    defaultCommissionPercent: z.number().min(0).max(100),
    perBusFeeMinor: z.number().int().min(0),
    gstRatePercent: gstRate,
    commissionGstRatePercent: gstRate,
    smsFeeMinor: z.number().int().min(0),
    whatsappFeeMinor: z.number().int().min(0),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one setting');
export type PlatformSettingsDto = z.infer<typeof PlatformSettingsSchema>;

export const MarkPayoutsSentSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });
export type MarkPayoutsSentDto = z.infer<typeof MarkPayoutsSentSchema>;

export const ReasonSchema = z.object({ reason });
export type ReasonDto = z.infer<typeof ReasonSchema>;
