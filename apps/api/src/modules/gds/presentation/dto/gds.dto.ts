import { z } from 'zod';

import { SALES_CHANNEL_FAMILIES } from '@contracts';

import { RegisterWebhookSchema } from '../../../webhooks';
import {
  AGREEMENT_STATUSES,
  BILLING_MODES,
  PARTNER_KINDS,
  SETTABLE_PARTNER_STATUSES,
  PARTNER_STATUSES,
} from '../../domain/gds-partner';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/);
const seatNumbers = z.array(z.string().trim().min(1)).min(1).max(6);
const commissionPct = z.number().min(0).max(30);

/* ── Partner API (X-GDS-Key) ─────────────────────────────────────────────── */

export const GdsSearchSchema = z.object({
  originCityId: uuid,
  destCityId: uuid,
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GdsSearchDto = z.infer<typeof GdsSearchSchema>;

export const GdsBlockSchema = z.object({
  tripId: uuid,
  fromStopId: uuid,
  toStopId: uuid,
  seatNumbers,
  passengers: z
    .array(
      z.object({
        seatNumber: z.string().trim().min(1),
        fullName: z.string().trim().min(2).max(120),
        age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(['male', 'female', 'other']).optional(),
      }),
    )
    .min(1)
    .max(6),
  contactPhone: phone,
  contactEmail: z.string().trim().email().optional(),
});
export type GdsBlockDto = z.infer<typeof GdsBlockSchema>;

export const GdsCancelSchema = z.object({
  seatNumbers: seatNumbers.optional(),
  reason: z.string().trim().max(300).optional(),
});
export type GdsCancelDto = z.infer<typeof GdsCancelSchema>;

/* ── Platform admin ──────────────────────────────────────────────────────── */

export const CreatePartnerSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(PARTNER_KINDS).default('ota'),
  billingMode: z.enum(BILLING_MODES),
  creditLimitMinor: z.number().int().nonnegative().default(0),
  defaultCommissionPct: commissionPct.default(8),
  contactEmail: z.string().email().optional(),
  contactPhone: phone.optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional(),
});
export type CreatePartnerDto = z.infer<typeof CreatePartnerSchema>;

export const ListPartnersQuerySchema = z.object({ status: z.enum(PARTNER_STATUSES).optional() });
export type ListPartnersQueryDto = z.infer<typeof ListPartnersQuerySchema>;

export const SetPartnerStatusSchema = z.object({
  status: z.enum(SETTABLE_PARTNER_STATUSES),
  reason: z.string().trim().max(300).optional(),
});
export type SetPartnerStatusDto = z.infer<typeof SetPartnerStatusSchema>;

export const PartnerTermsSchema = z.object({
  billingMode: z.enum(BILLING_MODES).optional(),
  creditLimitMinor: z.number().int().nonnegative().optional(),
  defaultCommissionPct: commissionPct.optional(),
});
export type PartnerTermsDto = z.infer<typeof PartnerTermsSchema>;

/** Money received from a prepaid partner (bank transfer reference). */
export const PartnerReceiptSchema = z.object({
  amountMinor: z.number().int().positive(),
  reference: z.string().trim().min(3).max(60),
});
export type PartnerReceiptDto = z.infer<typeof PartnerReceiptSchema>;

/** A partner has exactly one endpoint, so it carries no name. */
export const PartnerWebhookSchema = RegisterWebhookSchema.omit({ name: true });
export type PartnerWebhookDto = z.infer<typeof PartnerWebhookSchema>;

export const IssueKeySchema = z.object({
  label: z.string().trim().min(2).max(60),
  sandbox: z.boolean().default(false),
  ipAllowlist: z
    .array(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/))
    .max(20)
    .default([]),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});
export type IssueKeyDto = z.infer<typeof IssueKeySchema>;

/* ── Operator ────────────────────────────────────────────────────────────── */

export const AgreementSchema = z.object({
  status: z.enum(AGREEMENT_STATUSES),
  commissionPct,
});
export type AgreementDto = z.infer<typeof AgreementSchema>;

/** Channel families closed for sale on one trip; the rest keep selling. */
export const ClosedChannelsSchema = z.object({
  closed: z.array(z.enum(SALES_CHANNEL_FAMILIES)).max(SALES_CHANNEL_FAMILIES.length),
});
export type ClosedChannelsDto = z.infer<typeof ClosedChannelsSchema>;
