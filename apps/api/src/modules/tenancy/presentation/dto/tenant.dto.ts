import { z } from 'zod';

import { ifscSchema, pincodeSchema } from '@http';

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

const mobile10 = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));
const knownTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * The operator's own company profile. Legal name and GSTIN are verified by the
 * platform and printed on tax invoices, so they are not editable here; logo and
 * invoice prefix have their own endpoints. Unknown fields are refused.
 */
export const UpdateTenantSchema = z
  .object({
    displayName: z.string().trim().min(2, 'At least 2 characters').max(120).optional(),
    contactEmail: z.string().trim().toLowerCase().email('Enter a valid email').max(320).optional(),
    contactPhone: mobile10.optional(),
    /** A second person to call — `null` removes them. */
    secondaryContact: z
      .object({
        name: z.string().trim().min(2, 'At least 2 characters').max(120),
        phone: mobile10,
        email: z.string().trim().toLowerCase().email('Enter a valid email').max(320).optional(),
      })
      .nullable()
      .optional(),
    address: z
      .object({
        line1: z.string().trim().min(3, 'Building and street').max(200),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(2, 'City').max(80),
        state: z.string().trim().min(2, 'State').max(80),
        pincode: pincodeSchema,
      })
      .optional(),
    timezone: z.string().refine(knownTimeZone, 'Not a known time zone').optional(),
    currency: z.enum(['INR', 'USD', 'AED', 'LKR', 'NPR', 'BDT']).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Like en-IN')
      .optional(),
  })
  .strict();
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;

export const SetBankDetailsSchema = z.object({
  accountHolder: z.string().trim().min(2, 'Enter the name on the account').max(200),
  /** Indian bank accounts are 9–18 digits; spaces are dropped. */
  accountNumber: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{9,18}$/, 'An account number is 9 to 18 digits')),
  ifsc: ifscSchema,
  bankName: z.string().trim().max(120).optional(),
});
export type SetBankDetailsDto = z.infer<typeof SetBankDetailsSchema>;

/**
 * An operator's own cancellation/refund tiers — see migration 0037. `null`
 * (via the reset endpoint, not this schema) reverts to the platform default;
 * a submitted policy must have at least one tier, and every tier's
 * refundPct must be a valid percentage.
 */
export const RefundPolicySchema = z
  .object({
    tiers: z
      .array(
        z.object({
          minHoursBeforeDeparture: z.number().int().min(0).max(720),
          refundPct: z.number().min(0).max(100),
        }),
      )
      .min(1, 'At least one tier is required')
      .max(10, 'At most 10 tiers'),
    /** A fixed fee kept on every cancellation, at most ₹10,000. */
    flatFeeMinor: z.number().int().min(0).max(1_000_000).optional(),
    cutoffHours: z.number().int().min(0).max(720).optional(),
    /** Off = customers, agents and partners cancel whole bookings only. */
    partialCancellation: z.boolean().optional(),
    /** Minutes after departure before a passenger can be marked a no-show (0–4 hours). */
    noShowGraceMinutes: z.number().int().min(0).max(240).optional(),
    /** Full refund when cancelled within this many hours of paying (0 = none). */
    freeCancellationHours: z.number().min(0).max(72).optional(),
  })
  .superRefine((p, ctx) => {
    const sorted = [...p.tiers].sort(
      (a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].minHoursBeforeDeparture === sorted[i - 1].minHoursBeforeDeparture) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers'],
          message: `Two tiers start at ${sorted[i].minHoursBeforeDeparture} hours — keep one`,
        });
        return;
      }
      // Cancelling earlier can never give back less than cancelling later.
      if (sorted[i].refundPct > sorted[i - 1].refundPct) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers'],
          message: `Cancelling ${sorted[i - 1].minHoursBeforeDeparture}+ hours ahead refunds less than ${sorted[i].minHoursBeforeDeparture}+ hours — earlier should never refund less`,
        });
        return;
      }
    }
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
    z
      .string()
      .max(700_000)
      .regex(
        /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/,
        'Must be a PNG, JPEG, WebP or SVG data URI',
      ),
  ]),
});
export type SetLogoDto = z.infer<typeof SetLogoSchema>;

export const SetInvoicePrefixSchema = z.object({
  // Sanitized further (non-alphanumeric stripped, upper-cased) by
  // formatInvoiceNumber() itself — this just bounds the length and allows
  // clearing it back to the platform default with an empty string.
  prefix: z
    .string()
    .max(10)
    .regex(/^[A-Za-z0-9]*$/, 'Letters and digits only'),
});
export type SetInvoicePrefixDto = z.infer<typeof SetInvoicePrefixSchema>;

/**
 * Connections that change onto this operator's buses: whether it takes part
 * at all, and how long a change must take at least / may take at most.
 */
export const ConnectionRulesSchema = z
  .object({
    enabled: z.boolean(),
    minLayoverMin: z.number().int().min(15).max(720),
    maxLayoverMin: z.number().int().min(30).max(1440),
  })
  .refine((r) => r.maxLayoverMin > r.minLayoverMin, {
    message: 'The longest wait must be more than the shortest',
    path: ['maxLayoverMin'],
  });
export type ConnectionRulesDto = z.infer<typeof ConnectionRulesSchema>;

/** An operator's waitlist rules (#237, #239). */
export const WaitlistRulesSchema = z.object({
  maxPerTrip: z.number().int().min(1).max(500),
  maxSeatsPerEntry: z.number().int().min(1).max(10),
  closeMinutesBefore: z.number().int().min(0).max(1440),
  /** A waiting entry lapses this many hours after joining; null = waits until the list closes. */
  entryExpiryHours: z.number().int().min(1).max(720).nullable(),
});
export type WaitlistRulesDto = z.infer<typeof WaitlistRulesSchema>;

/** What a passenger may carry free, and what more costs (#252, #253). */
export const LuggagePolicySchema = z.object({
  freeKg: z.number().int().min(0).max(100),
  freePieces: z.number().int().min(0).max(10),
  /** Charged per kg over the free weight, in paise; null = extra luggage is sold as an add-on per piece. */
  extraPerKgMinor: z.number().int().min(100).max(100_000).nullable(),
  note: z.string().trim().max(300).default(''),
});
export type LuggagePolicyDto = z.infer<typeof LuggagePolicySchema>;

/**
 * The other rules a passenger sees before booking ("Other policies" under the seat map):
 * pets, liquor, smoking, how long the bus waits at a pickup point, plus any
 * notes of the operator's own. Child tickets come from the passenger policy
 * and luggage from the luggage policy.
 */
export const TravelPoliciesSchema = z.object({
  pets: z.enum(['not_allowed', 'small_in_carrier', 'allowed']),
  liquor: z.enum(['prohibited', 'sealed_in_luggage']),
  smoking: z.enum(['prohibited', 'at_stops_only']),
  /** Minutes the bus waits at a boarding point after its time; 0 = leaves on time. */
  pickupWaitMinutes: z.number().int().min(0).max(30),
  notes: z.array(z.string().trim().min(3).max(200)).max(8).default([]),
});
export type TravelPoliciesDto = z.infer<typeof TravelPoliciesSchema>;
