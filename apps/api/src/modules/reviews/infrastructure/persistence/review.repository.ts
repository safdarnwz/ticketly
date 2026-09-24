import { Injectable } from '@nestjs/common';

import { DatabaseService, isUniqueViolation } from '@database';
import {
  AppError,
  ErrorCode,
  newId,
  requireTenantId,
  type BookingId,
  type RouteId,
  type TripId,
  type UserId,
} from '@kernel';

export interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  verified: boolean;
  createdAt: string;
}

/**
 * Review persistence. One review per booking is guaranteed by the
 * `UNIQUE (tenant_id, booking_id)` index — the DB, not a read-then-write check,
 * is the real guard against a double review under concurrency.
 */
@Injectable()
export class ReviewRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: {
    bookingId: BookingId;
    customerId: UserId | null;
    routeId: RouteId | null;
    tripId: TripId | null;
    rating: number;
    title?: string;
    body?: string;
    verified: boolean;
  }): Promise<string> {
    const id = newId();
    try {
      await this.db.execute_(
        `INSERT INTO reviews (id, tenant_id, booking_id, customer_id, route_id, trip_id, rating, title, body, verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          requireTenantId(),
          input.bookingId,
          input.customerId,
          input.routeId,
          input.tripId,
          input.rating,
          input.title ?? null,
          input.body ?? null,
          input.verified,
        ],
        { name: 'review.insert', primary: true },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.REVIEW_ALREADY_EXISTS, 409, {
          message: 'This booking has already been reviewed',
        });
      }
      throw error;
    }
    return id;
  }

  /** Published star values for a route (drives aggregation). */
  async ratingsForRoute(routeId: RouteId): Promise<number[]> {
    const rows = await this.db.query<{ rating: number }>(
      `SELECT rating FROM reviews WHERE tenant_id = $1 AND route_id = $2 AND status = 'published'`,
      [requireTenantId(), routeId],
      { name: 'review.ratingsForRoute' },
    );
    return rows.map((r) => Number(r.rating));
  }

  async listForRoute(routeId: RouteId, limit = 20): Promise<ReviewRow[]> {
    return this.db.query<ReviewRow>(
      `SELECT id, rating, title, body, verified, created_at AS "createdAt"
         FROM reviews WHERE tenant_id = $1 AND route_id = $2 AND status = 'published'
        ORDER BY created_at DESC LIMIT $3`,
      [requireTenantId(), routeId, limit],
      { name: 'review.listForRoute' },
    );
  }
}
