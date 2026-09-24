import { z } from 'zod';

export const TicketScanSchema = z.object({ boardingCode: z.string().min(3).max(40) });
export type TicketScanDto = z.infer<typeof TicketScanSchema>;

export const TripStatusSchema = z.object({ status: z.enum(['departed', 'closed']) });
export type TripStatusDto = z.infer<typeof TripStatusSchema>;
