import { z } from 'zod';

export const CreateReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
});
export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;

export const RouteReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RouteReviewsQueryDto = z.infer<typeof RouteReviewsQuerySchema>;

export const OperatorReviewsQuerySchema = z.object({
  routeId: z.string().uuid().optional(),
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
