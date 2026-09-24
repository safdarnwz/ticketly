import { z } from 'zod';

export const CreateReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
});
export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;

export const RouteReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type RouteReviewsQueryDto = z.infer<typeof RouteReviewsQuerySchema>;
