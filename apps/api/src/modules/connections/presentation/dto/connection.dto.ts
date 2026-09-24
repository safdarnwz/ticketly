import { z } from 'zod';

import { TestInstrumentSchema } from '../../../payment';

/** Pay for both legs (each its own operator's charge) with a sandbox instrument each. */
export const ConfirmConnectionSchema = z.object({
  leg1Instrument: TestInstrumentSchema,
  leg2Instrument: TestInstrumentSchema,
});
export type ConfirmConnectionDto = z.infer<typeof ConfirmConnectionSchema>;

export const ConnectionLegSchema = z.object({
  tenantId: z.string().uuid(),
  quoteId: z.string(),
  seatNumbers: z.array(z.string()).min(1),
  passengers: z
    .array(
      z.object({
        seatNumber: z.string(),
        fullName: z.string().min(1),
        age: z.number().int().min(1).max(120).optional(),
        gender: z.string().optional(),
      }),
    )
    .min(1),
});
export type ConnectionLegDto = z.infer<typeof ConnectionLegSchema>;

export const HoldConnectionSchema = z.object({
  leg1: ConnectionLegSchema,
  leg2: ConnectionLegSchema,
  contactPhone: z.string().min(6),
  contactEmail: z.string().email().optional(),
  customerId: z.string().uuid().optional(),
});
export type HoldConnectionDto = z.infer<typeof HoldConnectionSchema>;
