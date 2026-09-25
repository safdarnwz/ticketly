import { z } from 'zod';

import { localDateQuery as localDate } from '@http';

export const GenerateInvoiceSchema = z.object({
  tenantId: z.string().uuid(),
  from: localDate,
  to: localDate,
});
export type GenerateInvoiceDto = z.infer<typeof GenerateInvoiceSchema>;

export const InvoiceListQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});
export type InvoiceListQueryDto = z.infer<typeof InvoiceListQuerySchema>;

export const CreateDiscountSchema = z.object({
  /** Omit for a discount on every operator's invoice. */
  tenantId: z.string().uuid().nullable().default(null),
  kind: z.enum(['percent', 'flat']),
  /** Percent (0–100] or flat amount in paise. */
  value: z.number().positive(),
  reason: z.string().trim().min(3).max(300),
  validFrom: localDate,
  validTo: localDate.nullable().default(null),
});
export type CreateDiscountDto = z.infer<typeof CreateDiscountSchema>;
