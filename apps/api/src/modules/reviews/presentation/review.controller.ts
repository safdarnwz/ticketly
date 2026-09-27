import { Body, Controller, Get, Post, Put, Query, HttpCode } from '@nestjs/common';
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
import {
  BadRequestError,
  decodeCursor,
  encodeCursor,
  isUuid,
  type BookingId,
  type RouteId,
} from '@kernel';

import { ReviewService } from '../application/services/review.service';
import {
  BusReviewsQuerySchema,
  type BusReviewsQueryDto,
  CreateReviewSchema,
  OperatorReviewsQuerySchema,
  ReportReviewSchema,
  ReviewReplySchema,
  RouteReviewsQuerySchema,
  type CreateReviewDto,
  type OperatorReviewsQueryDto,
  type ReportReviewDto,
  type ReviewReplyDto,
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
  // Any signed-in account: the service allows only the traveller who booked
  // (staff have no customer bookings). BOOKING_READ is a staff permission —
  // requiring it locked every customer out of reviewing.
  @ApiOperation({ summary: 'Leave a review for a completed booking (verified travellers only)' })
  async create(@Body(zodBody(CreateReviewSchema)) dto: CreateReviewDto) {
    return this.reviews.create({
      bookingId: dto.bookingId as BookingId,
      rating: dto.rating,
      title: dto.title,
      body: dto.body,
      liked: dto.liked,
    });
  }

  @Get('buses/:vehicleId/reviews')
  @Public()
  @ApiOperation({
    summary:
      "A bus's rating and reviews — each review stays with the bus that ran the trip, whatever bus runs the service later",
  })
  async forBus(
    @UuidParam('vehicleId') vehicleId: string,
    @Query(zodQuery(BusReviewsQuerySchema)) q: BusReviewsQueryDto,
  ) {
    return this.reviews.busReviews(vehicleId, q.limit, q.offset);
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

  /* ── the operator's side ─────────────────────────────────────────────── */

  @Get('reviews')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({
    summary:
      "This operator's reviews, newest first — by route, bus, stars, unanswered / low / reported — with a summary",
  })
  async forOperator(@Query(zodQuery(OperatorReviewsQuerySchema)) q: OperatorReviewsQueryDto) {
    let before: { createdAt: string; id: string } | undefined;
    if (q.cursor) {
      let c: ReturnType<typeof decodeCursor> | undefined;
      try {
        c = decodeCursor(q.cursor);
      } catch {
        c = undefined;
      }
      const [at, id] = c?.k ?? [];
      if (c?.v !== 1 || typeof at !== 'string' || Number.isNaN(Date.parse(at)) || !isUuid(id))
        throw new BadRequestError('That page link is no longer valid — start from the first page');
      before = { createdAt: at, id };
    }
    const [rows, summary] = await Promise.all([
      this.reviews.listForOperator({
        routeId: q.routeId,
        vehicleId: q.vehicleId,
        rating: q.rating,
        filter: q.filter,
        before,
        limit: q.limit + 1,
      }),
      this.reviews.operatorSummary(q.routeId, q.vehicleId),
    ]);
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map(({ createdAtRaw: _raw, ...r }) => r);
    const last = rows[Math.min(rows.length, q.limit) - 1];
    return {
      summary,
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ v: 1, k: [last.createdAtRaw.toISOString(), last.id], d: 'desc' })
          : null,
    };
  }

  @Put('reviews/:id/reply')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Answer a review publicly (an empty reply removes it)' })
  async reply(@UuidParam('id') id: string, @Body(zodBody(ReviewReplySchema)) dto: ReviewReplyDto) {
    await this.reviews.reply(id, dto.reply);
    return { ok: true };
  }

  @Post('reviews/:id/report')
  @HttpCode(200)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary: 'Report an abusive / fake review to the platform (operators cannot hide reviews)',
  })
  async report(
    @UuidParam('id') id: string,
    @Body(zodBody(ReportReviewSchema)) dto: ReportReviewDto,
  ) {
    await this.reviews.report(id, dto.note ? `${dto.reason}: ${dto.note}` : dto.reason);
    return { ok: true };
  }
}
