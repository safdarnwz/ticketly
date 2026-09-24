import { z } from 'zod';

export const TranslationSchema = z.object({
  locale: z.string().min(2).max(10),
  key: z.string().min(1).max(160),
  value: z.string().min(1).max(4000),
});
export type TranslationDto = z.infer<typeof TranslationSchema>;

export const ExchangeRateSchema = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rateMicros: z.number().int().positive(),
  asOf: z.string().datetime(),
});
export type ExchangeRateDto = z.infer<typeof ExchangeRateSchema>;

export const ConvertQuerySchema = z.object({
  amountMinor: z.coerce.number().int().nonnegative(),
  from: z.string().trim().length(3).toUpperCase(),
  to: z.string().trim().length(3).toUpperCase(),
});
export type ConvertQueryDto = z.infer<typeof ConvertQuerySchema>;
