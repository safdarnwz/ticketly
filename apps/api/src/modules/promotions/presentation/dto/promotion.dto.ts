import { z } from 'zod';

export const SetPromotionRateSchema = z.object({
  billingCycle: z.enum(['daily', 'weekly', 'monthly']),
  isMultiRoute: z.boolean(),
  priceMinor: z.number().int().min(0),
});
export type SetPromotionRateDto = z.infer<typeof SetPromotionRateSchema>;

export const PurchasePromotionSchema = z.object({
  routeIds: z.array(z.string().uuid()).min(1).max(50),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  autoRenew: z.boolean().default(false),
});
export type PurchasePromotionDto = z.infer<typeof PurchasePromotionSchema>;
