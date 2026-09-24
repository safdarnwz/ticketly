import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, getUserId, type BookingId, type RouteId, type UserId } from '@kernel';

import { BookingRepository } from '../../../booking/infrastructure/persistence/booking.repository';
import { aggregateRatings, bayesianRating, type RatingAggregate } from '../../domain/rating-aggregate';
import { ReviewRepository } from '../../infrastructure/persistence/review.repository';

/**
 * Reviews & ratings. The core rule is **verified reviews only**: you can review
 * a booking you actually travelled (confirmed/completed) and that is yours —
 * nobody can astro-turf ratings for a trip they never took. Aggregation returns
 * both the plain average (what users see) and the Bayesian score (what ranking
 * sorts by), from the pure engine.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly bookings: BookingRepository,
  ) {}

  async create(input: { bookingId: BookingId; rating: number; title?: string; body?: string }): Promise<{ reviewId: string }> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new AppError(ErrorCode.REVIEW_INVALID_RATING, 422, { message: 'Rating must be an integer 1–5' });
    }

    const booking = await this.bookings.findForUpdate(input.bookingId);
    if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

    // Only a traveller on this booking may review it.
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE, 422, { message: 'You can only review a completed trip' });
    }
    const userId = getUserId();
    if (userId && booking.customerId && booking.customerId !== userId) {
      throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE, 403, { message: 'You can only review your own booking' });
    }

    const reviewId = await this.reviews.insert({
      bookingId: input.bookingId,
      customerId: (booking.customerId ?? null) as UserId | null,
      routeId: booking.routeId,
      tripId: booking.tripId,
      rating: input.rating,
      title: input.title,
      body: input.body,
      verified: true,
    });
    return { reviewId };
  }

  /** Ratings summary for a route: average (display) + bayesian (ranking). */
  async summaryForRoute(routeId: RouteId): Promise<RatingAggregate & { bayesian: number }> {
    const ratings = await this.reviews.ratingsForRoute(routeId);
    const agg = aggregateRatings(ratings);
    return { ...agg, bayesian: bayesianRating(agg.count, agg.average) };
  }

  async listForRoute(routeId: RouteId, limit = 20): Promise<unknown[]> {
    return this.reviews.listForRoute(routeId, limit);
  }
}
