import { z } from 'zod';
import { TICKET_STATUSES } from '../../domain/ticket-state';

export const OpenSupportTicketSchema = z.object({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  category: z.enum(['refund', 'booking', 'payment', 'general']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  bookingId: z.string().uuid().optional(),
});
export type OpenSupportTicketDto = z.infer<typeof OpenSupportTicketSchema>;

export const SupportReplySchema = z.object({
  authorKind: z.enum(['customer', 'agent', 'system']).default('customer'),
  body: z.string().min(1).max(4000),
});
export type SupportReplyDto = z.infer<typeof SupportReplySchema>;

export const SupportTransitionSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']),
});
export type SupportTransitionDto = z.infer<typeof SupportTransitionSchema>;

export const ListSupportTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
});
export type ListSupportTicketsQueryDto = z.infer<typeof ListSupportTicketsQuerySchema>;
