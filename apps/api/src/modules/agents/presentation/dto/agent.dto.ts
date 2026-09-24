import { z } from 'zod';

import { OptionalDateRangeQuerySchema, searchText } from '@http';

import { BOOKING_STATUSES } from '../../../booking';
import { AGENT_STATUSES } from '../../domain/agent-account';

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number (10–15 digits)');
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN');
const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN');
const paise = z.number().int('Amount must be whole paise').nonnegative();

export const CreateAgentSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and "-" only')
      .optional(),
    contactName: z.string().trim().max(120).optional(),
    contactPhone: phone,
    contactEmail: z.string().trim().email().optional(),
    gstin: gstin.optional(),
    pan: pan.optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(80).optional(),
    branchId: z.string().uuid().optional(),
    billingMode: z.enum(['prepaid', 'postpaid']),
    commissionPct: z.number().min(0).max(50),
    creditLimitMinor: paise.optional(),
    lowBalanceAlertMinor: paise.optional(),
    paymentTermsDays: z.number().int().min(0).max(90).optional(),
    loginEmail: z.string().trim().email(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    activate: z.boolean().optional(),
  })
  .refine((d) => d.billingMode === 'postpaid' || !d.creditLimitMinor, {
    message: 'A prepaid agent cannot have a credit limit',
    path: ['creditLimitMinor'],
  });
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: phone.optional(),
  contactEmail: z.string().trim().email().optional(),
  gstin: gstin.optional(),
  pan: pan.optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  branchId: z.string().uuid().optional(),
  billingMode: z.enum(['prepaid', 'postpaid']).optional(),
  commissionPct: z.number().min(0).max(50).optional(),
  creditLimitMinor: paise.optional(),
  lowBalanceAlertMinor: paise.optional(),
  paymentTermsDays: z.number().int().min(0).max(90).optional(),
});
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>;

export const AgentStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.status === 'active' || (d.reason?.length ?? 0) >= 10, {
    message: 'A reason of at least 10 characters is required to suspend or reject',
    path: ['reason'],
  });
export type AgentStatusDto = z.infer<typeof AgentStatusSchema>;

export const ReceiptSchema = z.object({
  amountMinor: z
    .number()
    .int()
    .positive()
    .max(10_000_000_00, 'Amount too large for a single receipt'),
  /** Receipt / UTR / cheque number — makes a double-submitted form a no-op. */
  reference: z.string().trim().min(3).max(60),
  note: z.string().trim().max(300).optional(),
});
export type ReceiptDto = z.infer<typeof ReceiptSchema>;

export const AdjustmentSchema = z.object({
  amountMinor: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Adjustment cannot be zero'),
  reason: z.string().trim().min(10, 'Explain the adjustment (at least 10 characters)').max(300),
  reference: z.string().trim().max(60).optional(),
});
export type AdjustmentDto = z.infer<typeof AdjustmentSchema>;

export const ListAgentsQuerySchema = z.object({
  status: z.enum(AGENT_STATUSES).optional(),
  search: searchText.optional(),
});
export type ListAgentsQueryDto = z.infer<typeof ListAgentsQuerySchema>;

export const AgentLedgerQuerySchema = OptionalDateRangeQuerySchema.and(
  z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }),
);
export type AgentLedgerQueryDto = z.infer<typeof AgentLedgerQuerySchema>;

/** My bookings: a date window (history), or else the latest 200 in a status. */
export const AgentBookingsQuerySchema = OptionalDateRangeQuerySchema.and(
  z.object({ status: z.enum(BOOKING_STATUSES).optional() }),
);
export type AgentBookingsQueryDto = z.infer<typeof AgentBookingsQuerySchema>;

export const AgentBookSchema = z.object({
  quoteId: z.string().min(1),
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(10),
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
    .max(10),
  contactPhone: phone,
  contactEmail: z.string().trim().email().optional(),
});
export type AgentBookDto = z.infer<typeof AgentBookSchema>;

export const AgentCancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(10).optional(),
});
export type AgentCancelDto = z.infer<typeof AgentCancelSchema>;

export const SlabsSchema = z.object({
  slabs: z
    .array(
      z.object({
        minMonthlySalesMinor: z.number().int().nonnegative(),
        commissionPct: z.number().min(0).max(50),
      }),
    )
    .max(10),
});
export type SlabsDto = z.infer<typeof SlabsSchema>;
