import { z } from 'zod';

export const ChartTripSchema = z.object({
  spotSalesCount: z.number().int().min(0).max(200).default(0),
  spotSalesCashMinor: z.number().int().min(0).default(0),
  expectedSpotFareMinor: z.number().int().min(0).default(0),
});
export type ChartTripDto = z.infer<typeof ChartTripSchema>;
