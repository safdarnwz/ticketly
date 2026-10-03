import { z } from 'zod';

import { ifscSchema } from '@http';

export const AltAccountDetailsSchema = z.object({
  accountHolder: z.string().trim().min(2, 'Enter the name on the account').max(120),
  /** Indian bank accounts are 9–18 digits; spaces are dropped. */
  accountNumber: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{9,18}$/, 'An account number is 9 to 18 digits')),
  ifsc: ifscSchema,
  bankName: z.string().trim().max(120).optional(),
});

export const InitiateRefundSchema = z
  .object({
    bookingId: z.string().uuid(),
    amountMinor: z.number().int().min(100, 'A refund is at least ₹1').max(100_000_000),
    // Defaults to 'source' — the ORIGINAL payment method — unless the
    // customer explicitly chooses to receive the refund into a different
    // account, in which case altAccountDetails is required.
    destination: z.enum(['source', 'alternate_account']).default('source'),
    altAccountDetails: AltAccountDetailsSchema.optional(),
  })
  .refine((v) => v.destination !== 'alternate_account' || !!v.altAccountDetails, {
    message: 'Account details are required when refunding to an alternate account',
    path: ['altAccountDetails'],
  });
export type InitiateRefundDto = z.infer<typeof InitiateRefundSchema>;

export const ReconcileRefundSchema = z.object({
  gatewayRefundId: z.string().min(1).max(120),
  status: z.enum(['processed', 'failed']),
  reason: z.string().max(240).optional(),
});
export type ReconcileRefundDto = z.infer<typeof ReconcileRefundSchema>;

/** Recording a refund paid outside the gateway: the bank transfer's reference (UTR). */
export const MarkRefundPaidSchema = z.object({
  reference: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(
      z
        .string()
        .regex(/^[A-Z0-9]{6,30}$/, 'Enter the transfer reference (UTR), 6–30 letters or digits'),
    ),
});
export type MarkRefundPaidDto = z.infer<typeof MarkRefundPaidSchema>;

export const REFUND_QUEUES = ['action', 'processing', 'done', 'all'] as const;
export const RefundQueueSchema = z.object({
  /** action: failed, or waiting for a bank transfer · processing: with the gateway · done: paid or cancelled. */
  queue: z.enum(REFUND_QUEUES).default('action'),
  pnr: z.string().trim().toUpperCase().max(20).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RefundQueueDto = z.infer<typeof RefundQueueSchema>;
