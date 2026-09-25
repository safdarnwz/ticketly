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

/** Cross-tenant audit trail filters; `action` matches partially. */
export const AuditLogQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(80).optional(),
});
export type AuditLogQueryDto = z.infer<typeof AuditLogQuerySchema>;

/** #52 / #53 — export the last N days (30 and 90 are the usual picks). */
export const AuditLogExportQuerySchema = AuditLogQuerySchema.omit({ resourceType: true }).extend({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type AuditLogExportQueryDto = z.infer<typeof AuditLogExportQuerySchema>;

/** #4 — a hostname the operator controls, e.g. "book.orangetravels.in"; null removes it. */
export const SetDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(
      /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      'must be a hostname like book.example.com',
    )
    .nullable(),
});
export type SetDomainDto = z.infer<typeof SetDomainSchema>;

/** #67 — ICO / PNG / SVG favicon as a data URI (≤ ~100 KB); null removes it. */
export const SetFaviconSchema = z.object({
  dataUri: z
    .string()
    .max(140_000)
    .regex(
      /^data:image\/(x-icon|vnd\.microsoft\.icon|png|svg\+xml);base64,/,
      'Must be an ICO, PNG or SVG data URI',
    )
    .nullable(),
});
export type SetFaviconDto = z.infer<typeof SetFaviconSchema>;

/** #62 — requests per rate-limit window for this operator; null = platform default. */
export const SetRateLimitSchema = z.object({
  limit: z.number().int().min(10).max(1_000_000).nullable(),
});
export type SetRateLimitDto = z.infer<typeof SetRateLimitSchema>;
