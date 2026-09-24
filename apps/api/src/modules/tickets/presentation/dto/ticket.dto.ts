import { z } from 'zod';

export const VerifyTicketSchema = z.object({ token: z.string().min(10).max(4000) });
export type VerifyTicketDto = z.infer<typeof VerifyTicketSchema>;
