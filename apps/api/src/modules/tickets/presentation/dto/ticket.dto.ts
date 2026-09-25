import { z } from 'zod';

export const VerifyTicketSchema = z.object({ token: z.string().min(10).max(4000) });
export type VerifyTicketDto = z.infer<typeof VerifyTicketSchema>;

/** A guest proves the booking is theirs with its mobile number. */
export const TicketAccessQuerySchema = z.object({
  mobile: z.string().trim().min(6).max(20).optional(),
});
export type TicketAccessQueryDto = z.infer<typeof TicketAccessQuerySchema>;
