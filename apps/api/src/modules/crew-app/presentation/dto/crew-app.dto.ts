import { z } from 'zod';

export const TicketScanSchema = z.object({ boardingCode: z.string().min(3).max(40) });
export type TicketScanDto = z.infer<typeof TicketScanSchema>;

export const TripStatusSchema = z.object({ status: z.enum(['departed', 'closed']) });
export type TripStatusDto = z.infer<typeof TripStatusSchema>;

/** What a crew member can report from the road (an emergency goes through the panic button). */
export const CREW_REPORT_TYPES = [
  'breakdown',
  'fuel',
  'delay',
  'complaint',
  'cleaning',
  'maintenance',
  'other',
] as const;
export const CrewReportSchema = z.object({
  type: z.enum(CREW_REPORT_TYPES),
  description: z.string().trim().max(2000).optional(),
  delayCategory: z.string().trim().max(40).optional(),
  delayMinutes: z.number().int().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type CrewReportDto = z.infer<typeof CrewReportSchema>;

export const CrewLostItemSchema = z.object({
  description: z.string().trim().min(3).max(500),
  seatNumber: z.string().trim().max(10).optional(),
  storedAt: z.string().trim().max(120).optional(),
});
export type CrewLostItemDto = z.infer<typeof CrewLostItemSchema>;

/** A GPS fix from the crew phone while the bus is on the road. */
export const CrewPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmph: z.number().min(0).max(200).default(0),
  headingDeg: z.number().min(0).max(360).optional(),
  distanceCoveredM: z.number().int().min(0).default(0),
});
export type CrewPingDto = z.infer<typeof CrewPingSchema>;

/** The operator gives a crew member a crew-app login (their mobile + this password). */
export const CrewLoginSchema = z.object({ password: z.string().min(8).max(128) });
export type CrewLoginDto = z.infer<typeof CrewLoginSchema>;

/** The panic button: one tap, location optional. */
export const SosSchema = z.object({
  kind: z.enum(['sos', 'medical', 'security', 'accident']).default('sos'),
  lat: z.number().optional(),
  lng: z.number().optional(),
  description: z.string().trim().max(500).optional(),
});
export type SosDto = z.infer<typeof SosSchema>;
