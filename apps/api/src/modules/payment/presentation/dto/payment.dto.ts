import { z } from 'zod';

import { daysBetween, type LocalDate } from '@kernel';

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CreateIntentSchema = z.object({ bookingId: uuid });
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;

/**
 * One TEST / SANDBOX payment instrument — a discriminated union on `method`
 * so each method only accepts its own fields, validated at the edge.
 */
export const TestInstrumentSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('upi'), vpa: z.string().min(3).max(120) }),
  z.object({
    method: z.literal('credit_card'),
    cardNumber: z.string().min(12).max(23),
    expiry: z.string().min(4).max(7),
    cvv: z.string().min(3).max(4),
    holder: z.string().max(120).optional(),
  }),
  z.object({
    method: z.literal('debit_card'),
    cardNumber: z.string().min(12).max(23),
    expiry: z.string().min(4).max(7),
    cvv: z.string().min(3).max(4),
    holder: z.string().max(120).optional(),
  }),
  z.object({
    method: z.literal('net_banking'),
    bank: z.string().min(1).max(40),
    username: z.string().min(1).max(120),
    password: z.string().min(1).max(120),
  }),
]);
export type TestInstrumentDto = z.infer<typeof TestInstrumentSchema>;

export const ChargeTestSchema = z.object({ bookingId: uuid }).and(TestInstrumentSchema);
export type ChargeTestDto = z.infer<typeof ChargeTestSchema>;

/** An operator's negotiated platform commission (platform admin). */
export const SetCommissionSchema = z
  .object({
    tenantId: uuid,
    model: z.enum(['percent', 'flat', 'percent_plus']),
    percent: z.number().min(0).max(100).optional(),
    flatMinor: z.number().int().min(0).optional(),
    capMinor: z.number().int().min(0).optional(),
  })
  .refine((v) => v.model === 'flat' || v.percent !== undefined, {
    message: 'percent is required for this model',
    path: ['percent'],
  })
  .refine((v) => v.model === 'percent' || v.flatMinor !== undefined, {
    message: 'flatMinor is required for this model',
    path: ['flatMinor'],
  });
export type SetCommissionDto = z.infer<typeof SetCommissionSchema>;

export const UpgradeSeatSchema = z.object({
  ticketId: uuid,
  toSeatNumber: z.string().trim().min(1).max(10),
});
export type UpgradeSeatDto = z.infer<typeof UpgradeSeatSchema>;

/** Customer self-service: the booking's contact mobile proves ownership. */
export const SelfUpgradeSeatSchema = UpgradeSeatSchema.extend({
  bookingId: uuid,
  mobile: z.string().trim().min(6).max(20),
});
export type SelfUpgradeSeatDto = z.infer<typeof SelfUpgradeSeatSchema>;

/** Razorpay Checkout's client-side callback, verified server-side. */
export const VerifyPaymentSchema = z.object({
  bookingId: uuid,
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});
export type VerifyPaymentDto = z.infer<typeof VerifyPaymentSchema>;

/** Platform admin: settle one operator for a finished period (the payout scheduler does this weekly). */
export const GenerateSettlementSchema = z
  .object({
    tenantId: z.string().uuid(),
    periodFrom: localDate,
    periodTo: localDate,
  })
  .refine((d) => d.periodFrom <= d.periodTo, {
    message: 'The period must end on or after it starts',
    path: ['periodTo'],
  });
export type GenerateSettlementDto = z.infer<typeof GenerateSettlementSchema>;

export const FinaliseSettlementSchema = z.object({ tenantId: z.string().uuid() });
export type FinaliseSettlementDto = z.infer<typeof FinaliseSettlementSchema>;

export const LEDGER_ENTRY_TYPES = [
  'booking.captured',
  'booking.captured_offline',
  'booking.partner_commission',
  'refund.paid',
  'refund.offline',
  'refund.partner_commission',
  'settlement.paid',
] as const;

/** The journal: the operator's own days, at most a year at a time. */
export const LedgerJournalQuerySchema = z
  .object({
    from: localDate,
    to: localDate,
    type: z.enum(LEDGER_ENTRY_TYPES).optional(),
    pnr: z.string().trim().min(4).max(20).optional(),
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((d) => d.from <= d.to, { message: "'From' is after 'To'", path: ['to'] })
  .refine((d) => daysBetween(d.from as LocalDate, d.to as LocalDate) <= 366, {
    message: 'Pick at most a year',
    path: ['to'],
  });
export type LedgerJournalQueryDto = z.infer<typeof LedgerJournalQuerySchema>;
