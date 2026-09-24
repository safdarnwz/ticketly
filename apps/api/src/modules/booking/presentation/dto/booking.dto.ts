import { z } from 'zod';

const uuid = z.string().uuid();

export const HoldSchema = z.object({
  quoteId: uuid,
  seatNumbers: z.array(z.string().min(1)).min(1).max(10),
  passengers: z
    .array(
      z.object({
        seatNumber: z.string().min(1),
        fullName: z.string().min(1).max(120),
        age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(['male', 'female', 'other']).optional(),
        category: z.enum(['adult', 'child', 'senior', 'student', 'defence', 'disabled']).optional(),
        idProof: z.string().trim().max(40).optional(),
      }),
    )
    .min(1),
  infants: z
    .array(
      z.object({
        fullName: z.string().trim().min(1).max(120),
        age: z.number().int().min(0).max(5),
        guardianSeat: z.string().trim().min(1),
      }),
    )
    .max(6)
    .optional(),
  channel: z.enum(['direct_web', 'direct_app', 'ota', 'backoffice']).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
});
export type HoldDto = z.infer<typeof HoldSchema>;

export const ConfirmSchema = z.object({
  paidMinor: z.number().int().min(0),
  paymentReference: z.string().max(120).optional(),
});
export type ConfirmDto = z.infer<typeof ConfirmSchema>;

const AltAccountDetailsSchema = z.object({
  accountHolder: z.string().min(1).max(120),
  accountNumber: z.string().min(4).max(34),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  bankName: z.string().max(120).optional(),
});

export const CancelSchema = z
  .object({
    reason: z.string().max(500).optional(),
    // Defaults to 'source' (the original payment method) — the customer must
    // explicitly opt into a different account, and supply its details, to
    // change that.
    refundDestination: z.enum(['source', 'alternate_account']).default('source'),
    altAccountDetails: AltAccountDetailsSchema.optional(),
  })
  .refine((v) => v.refundDestination !== 'alternate_account' || !!v.altAccountDetails, {
    message: 'Account details are required to refund to an alternate account',
    path: ['altAccountDetails'],
  });
export type CancelDto = z.infer<typeof CancelSchema>;

export const CancelSeatsSchema = z
  .object({
    seatNumbers: z.array(z.string()).min(1, 'At least one seat must be specified'),
    reason: z.string().max(500).optional(),
    refundDestination: z.enum(['source', 'alternate_account']).default('source'),
    altAccountDetails: AltAccountDetailsSchema.optional(),
  })
  .refine((v) => v.refundDestination !== 'alternate_account' || !!v.altAccountDetails, {
    message: 'Account details are required to refund to an alternate account',
    path: ['altAccountDetails'],
  });
export type CancelSeatsDto = z.infer<typeof CancelSeatsSchema>;

/** Staff phone booking: same as a hold, contact phone mandatory, plus when unpaid seats are released. */
export const PhoneBookingSchema = HoldSchema.extend({
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, "Enter the caller's phone number"),
  releaseAt: z.string().datetime({ offset: true, message: 'releaseAt must be an ISO date-time' }),
});
export type PhoneBookingDto = z.infer<typeof PhoneBookingSchema>;

export const ExtendHoldSchema = z.object({ releaseAt: z.string().datetime({ offset: true }) });
export type ExtendHoldDto = z.infer<typeof ExtendHoldSchema>;

/** Customer self-cancel: the booking's contact mobile proves ownership. */
export const SelfCancelSchema = z.object({
  mobile: z.string().trim().min(6).max(20),
  reason: z.string().trim().max(300).optional(),
});
export type SelfCancelDto = z.infer<typeof SelfCancelSchema>;

export const CancelTripSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type CancelTripDto = z.infer<typeof CancelTripSchema>;
