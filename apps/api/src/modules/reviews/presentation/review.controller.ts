import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, Public, RequirePermission, zodBody } from '@http';
import { type BookingId, type RouteId } from '@kernel';

import { ReviewService } from '../application/services/review.service';

const CreateReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
});

@ApiTags('reviews')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post('reviews')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Leave a review for a completed booking (verified travellers only)' })
  async create(@Body(zodBody(CreateReviewSchema)) dto: z.infer<typeof CreateReviewSchema>) {
    return this.reviews.create({ bookingId: dto.bookingId as BookingId, rating: dto.rating, title: dto.title, body: dto.body });
  }

  @Get('routes/:routeId/reviews')
  @Public()
  @ApiOperation({ summary: 'Reviews + rating summary for a route' })
  async forRoute(@Param('routeId') routeId: string, @Query('limit') limit?: string) {
    const [summary, reviews] = await Promise.all([
      this.reviews.summaryForRoute(routeId as RouteId),
      this.reviews.listForRoute(routeId as RouteId, limit ? Math.min(Number(limit), 100) : 20),
    ]);
    return { summary, reviews };
  }
}
