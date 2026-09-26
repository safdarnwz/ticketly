import { z } from 'zod';

import { queryFlag } from '@http';
import { ESCALATION_STATUSES, TICKET_STATUSES } from '../../domain/ticket-state';

export const TICKET_CATEGORIES = ['refund', 'booking', 'payment', 'technical', 'general'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const OpenSupportTicketSchema = z.object({
  subject: z.string().trim().min(3, 'At least 3 characters').max(160),
  body: z.string().trim().min(5, 'Describe the problem in a few words').max(4000),
  category: z.enum(TICKET_CATEGORIES).default('general'),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  bookingId: z.string().uuid().optional(),
  /** Staff raising a ticket for a caller: the booking's PNR instead of its id. */
  pnr: z.string().trim().toUpperCase().max(20).optional(),
});
export type OpenSupportTicketDto = z.infer<typeof OpenSupportTicketSchema>;

/** Who wrote a reply is known from the signed-in account — never taken from the request. */
export const SupportReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(4000),
});
export type SupportReplyDto = z.infer<typeof SupportReplySchema>;

export const SupportTransitionSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});
export type SupportTransitionDto = z.infer<typeof SupportTransitionSchema>;

/** Staff: re-prioritise or (un)assign. `assignedTo: null` unassigns. */
export const UpdateTicketSchema = z
  .object({
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.priority !== undefined || v.assignedTo !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateTicketDto = z.infer<typeof UpdateTicketSchema>;

export const ListSupportTicketsQuerySchema = z.object({
  status: z.enum([...TICKET_STATUSES, 'active']).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  /** me = assigned to the signed-in staff member · none = nobody yet. */
  assigned: z.enum(['me', 'none']).optional(),
  /** Subject words or a PNR. */
  q: z.string().trim().max(80).optional(),
  /** Staff: only tickets escalated to the platform and not closed there. */
  escalated: queryFlag.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListSupportTicketsQueryDto = z.infer<typeof ListSupportTicketsQuerySchema>;

/** Staff → platform: what is wrong and what was tried. */
export const EscalateTicketSchema = z.object({
  reason: z.string().trim().min(10, 'Say what is wrong and what you tried').max(2000),
});
export type EscalateTicketDto = z.infer<typeof EscalateTicketSchema>;

export const ListEscalationsQuerySchema = z.object({
  status: z.enum([...ESCALATION_STATUSES, 'active']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListEscalationsQueryDto = z.infer<typeof ListEscalationsQuerySchema>;
