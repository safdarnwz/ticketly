import { z } from 'zod';

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CreateIntentSchema = z.object({ bookingId: uuid });
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;

/**
 * TEST / SANDBOX charge. A discriminated union on `method` so each method only
 * accepts its own fields, validated at the edge.
 */
export const ChargeTestSchema = z.object({ bookingId: uuid }).and(
  z.discriminatedUnion('method', [
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
  ]),
);
export type ChargeTestDto = z.infer<typeof ChargeTestSchema>;

export const SetCommissionSchema = z.object({
  routeId: uuid.optional(),
  model: z.enum(['percent', 'flat', 'percent_plus']),
  percent: z.number().min(0).max(100).optional(),
  flatMinor: z.number().int().min(0).optional(),
  capMinor: z.number().int().min(0).optional(),
});
export type SetCommissionDto = z.infer<typeof SetCommissionSchema>;

export const GenerateSettlementSchema = z.object({
  periodFrom: localDate,
  periodTo: localDate,
});
export type GenerateSettlementDto = z.infer<typeof GenerateSettlementSchema>;
