import { z } from 'zod';

/** What a traveller can say they liked — summed per bus into "loved by travellers". */
export const REVIEW_ASPECTS = [
  'cleanliness',
  'punctuality',
  'comfort',
  'staff',
  'ac',
  'driving',
  'tracking',
  'rest_stops',
] as const;

export const BusReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type BusReviewsQueryDto = z.infer<typeof BusReviewsQuerySchema>;

export const CreateReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
  /** What the traveller liked about the bus. */
  liked: z.array(z.enum(REVIEW_ASPECTS)).max(8).optional(),
});
export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;

export const RouteReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RouteReviewsQueryDto = z.infer<typeof RouteReviewsQuerySchema>;

export const OperatorReviewsQuerySchema = z.object({
  routeId: z.string().uuid().optional(),
  /** One bus: reviews stay with the bus that ran the trip. */
  vehicleId: z.string().uuid().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  filter: z.enum(['all', 'unanswered', 'low', 'reported']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type OperatorReviewsQueryDto = z.infer<typeof OperatorReviewsQuerySchema>;

/** The operator's public answer; an empty reply removes it. */
export const ReviewReplySchema = z.object({
  reply: z.string().trim().max(1000, 'At most 1000 characters'),
});
export type ReviewReplyDto = z.infer<typeof ReviewReplySchema>;

export const ReportReviewSchema = z.object({
  reason: z.enum(['abusive', 'spam', 'not_a_traveller', 'personal_data', 'other']),
  note: z.string().trim().max(500).optional(),
});
export type ReportReviewDto = z.infer<typeof ReportReviewSchema>;
