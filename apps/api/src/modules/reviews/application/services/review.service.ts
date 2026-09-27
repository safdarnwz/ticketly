import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, getUserId, type BookingId, type RouteId, type UserId } from '@kernel';

import { BookingRepository } from '../../../booking';
import {
  aggregateRatings,
  bayesianRating,
  type RatingAggregate,
} from '../../domain/rating-aggregate';
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

  async create(input: {
    bookingId: BookingId;
    rating: number;
    title?: string;
    body?: string;
    liked?: string[];
  }): Promise<{ reviewId: string }> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new AppError(ErrorCode.REVIEW_INVALID_RATING, 422, {
        message: 'Rating must be an integer 1–5',
      });
    }

    const booking = await this.bookings.findForUpdate(input.bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

    // Only the traveller's own account may review it — never staff (an
    // operator could otherwise rate its own buses through a guest booking).
    const userId = getUserId();
    if (!userId || !booking.customerId || booking.customerId !== userId) {
      throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE, 403, {
        message: 'Only the traveller who booked, signed in to that account, can review this trip',
      });
    }
    // …and only once they have travelled: a confirmed booking for next week is not a review.
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE, 422, {
        message: 'You can only review a completed trip',
      });
    }
    if (!(await this.reviews.tripTravelled(booking.tripId))) {
      throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE, 422, {
        message: 'You can review this trip once the bus has left',
      });
    }

    // The review is about the bus that ran this trip — it stays with that
    // bus even if another bus runs the service later.
    const reviewId = await this.reviews.insert({
      bookingId: input.bookingId,
      customerId: (booking.customerId ?? null) as UserId | null,
      routeId: booking.routeId,
      tripId: booking.tripId,
      vehicleId: await this.reviews.tripVehicle(booking.tripId),
      rating: input.rating,
      title: input.title,
      body: input.body,
      liked: input.liked,
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

  /** One bus's rating: average, stars 1–5, what travellers liked, latest reviews. */
  async busReviews(vehicleId: string, limit = 10, offset = 0) {
    if (!(await this.reviews.busExists(vehicleId)))
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Bus not found' });
    const [ratings, summary, items] = await Promise.all([
      this.reviews.busRatings([vehicleId]),
      this.reviews.busSummary(vehicleId),
      this.reviews.listForBus(vehicleId, limit, offset),
    ]);
    const r = ratings.get(vehicleId) ?? { average: 0, count: 0 };
    return { average: r.count ? r.average : null, count: r.count, ...summary, items };
  }

  async listForRoute(routeId: RouteId, limit = 20): Promise<unknown[]> {
    return this.reviews.listForRoute(routeId, limit);
  }

  /** The operator's reviews with a summary: stars, averages, what still needs an answer. */
  async operatorSummary(routeId?: string, vehicleId?: string) {
    const [ratings, extra] = await Promise.all([
      this.reviews.ratingsForOperator(routeId, vehicleId),
      this.reviews.operatorSummary(routeId, vehicleId),
    ]);
    const agg = aggregateRatings(ratings);
    return { ...agg, bayesian: bayesianRating(agg.count, agg.average), ...extra };
  }

  listForOperator(input: Parameters<ReviewRepository['listForOperator']>[0]) {
    return this.reviews.listForOperator(input);
  }

  async reply(id: string, text: string): Promise<void> {
    if (!(await this.reviews.setReply(id, text || null, getUserId() ?? null)))
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Review not found' });
  }

  async report(id: string, reason: string): Promise<void> {
    const done = await this.reviews.report(id, reason, getUserId() ?? null);
    if (done === null)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Review not found' });
    if (!done)
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'This review is already reported — the platform will look at it',
      });
  }
}
