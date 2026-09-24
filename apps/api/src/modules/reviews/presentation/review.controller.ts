import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { type BookingId, type RouteId } from '@kernel';

import { ReviewService } from '../application/services/review.service';
import {
  CreateReviewSchema,
  RouteReviewsQuerySchema,
  type CreateReviewDto,
  type RouteReviewsQueryDto,
} from './dto/review.dto';

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
  async create(@Body(zodBody(CreateReviewSchema)) dto: CreateReviewDto) {
    return this.reviews.create({
      bookingId: dto.bookingId as BookingId,
      rating: dto.rating,
      title: dto.title,
      body: dto.body,
    });
  }

  @Get('routes/:routeId/reviews')
  @Public()
  @ApiOperation({ summary: 'Reviews + rating summary for a route' })
  async forRoute(
    @UuidParam('routeId') routeId: string,
    @Query(zodQuery(RouteReviewsQuerySchema)) { limit }: RouteReviewsQueryDto,
  ) {
    const [summary, reviews] = await Promise.all([
      this.reviews.summaryForRoute(routeId as RouteId),
      this.reviews.listForRoute(routeId as RouteId, limit),
    ]);
    return { summary, reviews };
  }
}
