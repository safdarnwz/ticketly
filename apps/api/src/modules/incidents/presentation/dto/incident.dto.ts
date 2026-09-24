import { z } from 'zod';
import {
  DELAY_CATEGORIES,
  HANDOVER_SCOPES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  LOST_ITEM_STATUSES,
} from '../../domain/incident-rules';

export const ReportIncidentSchema = z.object({
  tripId: z.string().uuid().optional(),
  type: z.enum(INCIDENT_TYPES),
  description: z.string().trim().max(2000).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  delayCategory: z.enum(DELAY_CATEGORIES).optional(),
  delayMinutes: z.number().int().optional(),
  diversionVia: z.string().trim().max(300).optional(),
});
export type ReportIncidentDto = z.infer<typeof ReportIncidentSchema>;

export const SosSchema = z.object({
  kind: z.enum(['sos', 'medical', 'security', 'accident']).default('sos'),
  lat: z.number().optional(),
  lng: z.number().optional(),
  description: z.string().trim().max(500).optional(),
});
export type SosDto = z.infer<typeof SosSchema>;

export const IncidentTransitionSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'closed']),
  note: z.string().trim().max(2000).optional(),
});
export type IncidentTransitionDto = z.infer<typeof IncidentTransitionSchema>;

export const LostItemSchema = z.object({
  tripId: z.string().uuid().optional(),
  description: z.string().trim().min(3).max(500),
  seatNumber: z.string().trim().max(10).optional(),
  storedAt: z.string().trim().max(120).optional(),
});
export type LostItemDto = z.infer<typeof LostItemSchema>;

export const ClaimLostItemSchema = z.object({
  claimantName: z.string().trim().min(2).max(120),
  pnr: z.string().trim().max(20).optional(),
});
export type ClaimLostItemDto = z.infer<typeof ClaimLostItemSchema>;

export const HandoverNoteSchema = z.object({
  scope: z.enum(HANDOVER_SCOPES),
  note: z.string().trim().min(2).max(4000),
  branchId: z.string().uuid().optional(),
});
export type HandoverNoteDto = z.infer<typeof HandoverNoteSchema>;

/** `active` = open or acknowledged. */
export const ListIncidentsQuerySchema = z.object({
  status: z.enum([...INCIDENT_STATUSES, 'active']).optional(),
  tripId: z.string().uuid().optional(),
});
export type ListIncidentsQueryDto = z.infer<typeof ListIncidentsQuerySchema>;

export const ListLostItemsQuerySchema = z.object({ status: z.enum(LOST_ITEM_STATUSES).optional() });
export type ListLostItemsQueryDto = z.infer<typeof ListLostItemsQuerySchema>;

export const HandoverNotesQuerySchema = z.object({
  scope: z.enum(HANDOVER_SCOPES).default('dispatch'),
  branchId: z.string().uuid().optional(),
});
export type HandoverNotesQueryDto = z.infer<typeof HandoverNotesQuerySchema>;
