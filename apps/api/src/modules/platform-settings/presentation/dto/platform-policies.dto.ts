import { z } from 'zod';

import { PASSWORD_POLICY_LIMITS } from '../../domain/password-policy';

export const PasswordPolicySchema = z.object({
  minLength: z
    .number()
    .int()
    .min(PASSWORD_POLICY_LIMITS.minLength.min)
    .max(PASSWORD_POLICY_LIMITS.minLength.max),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireDigit: z.boolean(),
  requireSymbol: z.boolean(),
  /** 0 = passwords never expire. */
  expiryDays: z
    .number()
    .int()
    .min(PASSWORD_POLICY_LIMITS.expiryDays.min)
    .max(PASSWORD_POLICY_LIMITS.expiryDays.max),
});
export type PasswordPolicyDto = z.infer<typeof PasswordPolicySchema>;

export const IpAllowlistSchema = z.object({
  /** IPs or CIDR ranges; an empty list allows platform admins from anywhere. */
  entries: z.array(z.string().trim().min(2).max(64)).max(200),
});
export type IpAllowlistDto = z.infer<typeof IpAllowlistSchema>;

export const SuspiciousLoginSchema = z.object({
  enabled: z.boolean(),
  failedAttemptsThreshold: z.number().int().min(2).max(100),
  windowMinutes: z.number().int().min(1).max(1440),
  alertOnNewAdminIp: z.boolean(),
  alertEmails: z.array(z.string().trim().email()).max(20),
});
export type SuspiciousLoginDto = z.infer<typeof SuspiciousLoginSchema>;

export const GstSlabsSchema = z.object({
  slabs: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lower_snake_case code'),
        label: z.string().trim().min(2).max(100),
        ratePct: z.number().min(0).max(28),
        appliesTo: z.string().trim().min(2).max(40),
      }),
    )
    .min(1)
    .max(30),
});
export type GstSlabsDto = z.infer<typeof GstSlabsSchema>;

export const AgentCreditPolicySchema = z.object({
  defaultCreditLimitMinor: z.number().int().min(0),
  maxCreditLimitMinor: z.number().int().positive().nullable(),
});
export type AgentCreditPolicyDto = z.infer<typeof AgentCreditPolicySchema>;

const retentionDays = z.number().int().positive().max(3650).nullable().optional();
export const DataRetentionSchema = z.object({
  auditLogDays: retentionDays,
  notificationDays: retentionDays,
  gpsPingDays: retentionDays,
  webhookDeliveryDays: retentionDays,
  otpChallengeDays: retentionDays,
});
export type DataRetentionDto = z.infer<typeof DataRetentionSchema>;

export const OtaReleasePolicySchema = z.object({
  defaultReleasePct: z.number().int().min(0).max(100),
});
export type OtaReleasePolicyDto = z.infer<typeof OtaReleasePolicySchema>;
