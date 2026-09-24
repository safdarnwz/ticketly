import { z } from 'zod';

export const FraudAssessmentSchema = z.object({
  bookingId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  signals: z.object({
    accountAgeDays: z.number().int().min(0),
    bookingsLast24h: z.number().int().min(0),
    amountMinor: z.number().int().min(0),
    seatCount: z.number().int().min(0),
    emailDisposable: z.boolean().default(false),
    paymentMethodNew: z.boolean().default(false),
    billingCountryMismatch: z.boolean().default(false),
    nightBooking: z.boolean().default(false),
  }),
});
export type FraudAssessmentDto = z.infer<typeof FraudAssessmentSchema>;
