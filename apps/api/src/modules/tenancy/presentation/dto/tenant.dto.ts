import { z } from 'zod';

export const ProvisionTenantSchema = z.object({
  slug: z.string().min(2).max(63),
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(120),
  contactEmail: z.string().email().max(320),
  contactPhone: z.string().max(20).optional(),
  planCode: z.string().max(40).optional(),
  owner: z.object({
    fullName: z.string().min(1).max(120),
    email: z.string().email().max(320),
    password: z.string().min(8).max(256),
  }),
});
export type ProvisionTenantDto = z.infer<typeof ProvisionTenantSchema>;

export const SuspendTenantSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type SuspendTenantDto = z.infer<typeof SuspendTenantSchema>;

export const UpdateTenantSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  contactEmail: z.string().email().max(320).optional(),
  contactPhone: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
  currency: z.enum(['INR', 'USD', 'AED', 'LKR', 'NPR', 'BDT']).optional(),
  locale: z.string().max(16).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;

export const SetBankDetailsSchema = z.object({
  accountHolder: z.string().min(1).max(200),
  accountNumber: z.string().min(4).max(34).regex(/^[0-9]+$/, 'Account number must be numeric'),
  ifsc: z.string().length(11).regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i, 'Invalid IFSC format'),
  bankName: z.string().max(120).optional(),
});
export type SetBankDetailsDto = z.infer<typeof SetBankDetailsSchema>;

/**
 * An operator's own cancellation/refund tiers — see migration 0037. `null`
 * (via the reset endpoint, not this schema) reverts to the platform default;
 * a submitted policy must have at least one tier, and every tier's
 * refundPct must be a valid percentage.
 */
export const RefundPolicySchema = z.object({
  tiers: z.array(z.object({
    minHoursBeforeDeparture: z.number().min(0).max(720),
    refundPct: z.number().min(0).max(100),
  })).min(1, 'At least one tier is required'),
  flatFeeMinor: z.number().int().min(0).optional(),
  cutoffHours: z.number().min(0).max(720).optional(),
});
export type RefundPolicyDto = z.infer<typeof RefundPolicySchema>;

export const SetLogoSchema = z.object({
  // A data: URI, not a bare base64 string — carries its own MIME type, so
  // every consumer (e-ticket HTML <img src>, invoice PDF) can just drop it
  // in directly. ~700KB caps the ENCODED string (~500KB of actual image
  // data) — generous for a logo, small enough not to bloat every ticket
  // and invoice this gets embedded into. Empty string is the explicit
  // "remove my logo" case, not a malformed upload — allowed alongside the
  // real data: URI pattern rather than needing a separate delete endpoint.
  dataUri: z.union([
    z.literal(''),
    z.string().max(700_000).regex(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/, 'Must be a PNG, JPEG, WebP or SVG data URI'),
  ]),
});
export type SetLogoDto = z.infer<typeof SetLogoSchema>;

export const SetInvoicePrefixSchema = z.object({
  // Sanitized further (non-alphanumeric stripped, upper-cased) by
  // formatInvoiceNumber() itself — this just bounds the length and allows
  // clearing it back to the platform default with an empty string.
  prefix: z.string().max(10).regex(/^[A-Za-z0-9]*$/, 'Letters and digits only'),
});
export type SetInvoicePrefixDto = z.infer<typeof SetInvoicePrefixSchema>;
