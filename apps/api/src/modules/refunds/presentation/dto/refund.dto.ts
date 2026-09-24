import { z } from 'zod';

export const AltAccountDetailsSchema = z.object({
  accountHolder: z.string().min(1).max(120),
  accountNumber: z.string().min(4).max(34),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  bankName: z.string().max(120).optional(),
});

export const InitiateRefundSchema = z.object({
  bookingId: z.string().uuid(),
  amountMinor: z.number().int().min(1),
  // Defaults to 'source' — the ORIGINAL payment method — unless the
  // customer explicitly chooses to receive the refund into a different
  // account, in which case altAccountDetails is required.
  destination: z.enum(['source', 'alternate_account']).default('source'),
  altAccountDetails: AltAccountDetailsSchema.optional(),
}).refine((v) => v.destination !== 'alternate_account' || !!v.altAccountDetails, {
  message: 'Account details are required when refunding to an alternate account', path: ['altAccountDetails'],
});
export type InitiateRefundDto = z.infer<typeof InitiateRefundSchema>;

export const ReconcileRefundSchema = z.object({
  gatewayRefundId: z.string().min(1).max(120),
  status: z.enum(['processed', 'failed']),
  reason: z.string().max(240).optional(),
});
export type ReconcileRefundDto = z.infer<typeof ReconcileRefundSchema>;
