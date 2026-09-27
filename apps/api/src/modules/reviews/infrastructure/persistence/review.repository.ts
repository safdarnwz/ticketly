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
  /** The operator's public answer. */
  reply: string | null;
  repliedAt: string | null;
}

export interface OperatorReviewRow extends ReviewRow {
  routeId: string | null;
  routeName: string | null;
  pnr: string;
  journeyDate: string | null;
  status: string;
  reportReason: string | null;
  reportedAt: string | null;
  /** The bus the review is about (the one that ran the trip). */
  vehicleId: string | null;
  busNumber: string | null;
  liked: string[];
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
    vehicleId: string | null;
    rating: number;
    title?: string;
    body?: string;
    liked?: string[];
    verified: boolean;
  }): Promise<string> {
    const id = newId();
    try {
      await this.db.execute_(
        `INSERT INTO reviews (id, tenant_id, booking_id, customer_id, route_id, trip_id, rating, title, body, verified, vehicle_id, liked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[])`,
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
          input.vehicleId,
          [...new Set(input.liked ?? [])],
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

  /** The bus on the trip now — the one a review written after it left is about. */
  async tripVehicle(tripId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ vehicle_id: string | null }>(
      `SELECT vehicle_id FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'review.tripVehicle', primary: true },
    );
    return row?.vehicle_id ?? null;
  }

  async busExists(vehicleId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM vehicles WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), vehicleId],
      { name: 'review.busExists' },
    );
    return Boolean(row);
  }

  /** Average stars and count per bus (search results show the bus's own rating). */
  async busRatings(vehicleIds: string[]): Promise<Map<string, { average: number; count: number }>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await this.db.query<{ vehicle_id: string; average: string; count: number }>(
      `SELECT vehicle_id, round(avg(rating), 1) AS average, count(*)::int AS count
         FROM reviews WHERE tenant_id = $1 AND vehicle_id = ANY($2::uuid[]) AND status = 'published'
        GROUP BY vehicle_id`,
      [requireTenantId(), [...new Set(vehicleIds)]],
      { name: 'review.busRatings' },
    );
    return new Map(rows.map((r) => [r.vehicle_id, { average: Number(r.average), count: r.count }]));
  }

  /** One bus: stars 1–5, what travellers liked, and the latest reviews. */
  async busSummary(vehicleId: string): Promise<{
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    liked: { aspect: string; count: number }[];
  }> {
    const [dist, liked] = await Promise.all([
      this.db.query<{ rating: number; n: number }>(
        `SELECT rating, count(*)::int AS n FROM reviews
          WHERE tenant_id = $1 AND vehicle_id = $2 AND status = 'published' GROUP BY rating`,
        [requireTenantId(), vehicleId],
        { name: 'review.busDistribution' },
      ),
      this.db.query<{ aspect: string; count: number }>(
        `SELECT a AS aspect, count(*)::int AS count
           FROM reviews, unnest(liked) AS a
          WHERE tenant_id = $1 AND vehicle_id = $2 AND status = 'published'
          GROUP BY a ORDER BY count(*) DESC, a`,
        [requireTenantId(), vehicleId],
        { name: 'review.busLiked' },
      ),
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    for (const d of dist) distribution[Number(d.rating) as 1 | 2 | 3 | 4 | 5] = d.n;
    return { distribution, liked };
  }

  /** A bus's published reviews, newest first (the reviewer's first name only). */
  listForBus(vehicleId: string, limit: number, offset = 0) {
    return this.db.query<
      ReviewRow & { liked: string[]; reviewer: string | null; travelledOn: string | null }
    >(
      `SELECT r.id, r.rating, r.title, r.body, r.verified, r.created_at AS "createdAt",
              r.reply, r.replied_at AS "repliedAt", r.liked,
              nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') AS reviewer,
              (t.departs_at AT TIME ZONE coalesce(tn.timezone, 'Asia/Kolkata'))::date::text AS "travelledOn"
         FROM reviews r
         LEFT JOIN trips t ON t.id = r.trip_id
         JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN LATERAL (SELECT full_name FROM passengers WHERE booking_id = r.booking_id ORDER BY seat_number LIMIT 1) p ON true
        WHERE r.tenant_id = $1 AND r.vehicle_id = $2 AND r.status = 'published'
        ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`,
      [requireTenantId(), vehicleId, limit, offset],
      { name: 'review.listForBus' },
    );
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
      `SELECT id, rating, title, body, verified, created_at AS "createdAt",
              reply, replied_at AS "repliedAt"
         FROM reviews WHERE tenant_id = $1 AND route_id = $2 AND status = 'published'
        ORDER BY created_at DESC LIMIT $3`,
      [requireTenantId(), routeId, limit],
      { name: 'review.listForRoute' },
    );
  }

  /** Whether a trip has happened (departed, or its departure time has passed) and was not cancelled. */
  async tripTravelled(tripId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ ok: boolean }>(
      `SELECT (status <> 'cancelled' AND (actual_departed_at IS NOT NULL OR departs_at <= now())) AS ok
         FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'review.tripTravelled', primary: true },
    );
    return row?.ok ?? false;
  }

  /** The operator's reviews, newest first. */
  async listForOperator(input: {
    routeId?: string;
    vehicleId?: string;
    rating?: number;
    filter: 'all' | 'unanswered' | 'low' | 'reported';
    before?: { createdAt: string; id: string };
    limit: number;
  }): Promise<(OperatorReviewRow & { createdAtRaw: Date })[]> {
    const filters = {
      all: 'true',
      unanswered: 'rv.reply IS NULL',
      low: 'rv.rating <= 2',
      reported: 'rv.reported_at IS NOT NULL',
    } as const;
    return this.db.query(
      `SELECT rv.id, rv.rating, rv.title, rv.body, rv.verified, rv.created_at AS "createdAt", rv.created_at AS "createdAtRaw",
              rv.reply, rv.replied_at AS "repliedAt", rv.route_id AS "routeId", r.name AS "routeName",
              b.pnr, t.journey_date::text AS "journeyDate", rv.status,
              rv.report_reason AS "reportReason", rv.reported_at AS "reportedAt",
              rv.vehicle_id AS "vehicleId", v.registration_no AS "busNumber", rv.liked
         FROM reviews rv
         JOIN bookings b ON b.id = rv.booking_id
         LEFT JOIN routes r ON r.id = rv.route_id
         LEFT JOIN trips t ON t.id = rv.trip_id
         LEFT JOIN vehicles v ON v.id = rv.vehicle_id
        WHERE rv.tenant_id = $1 AND ${filters[input.filter]}
          AND ($2::uuid IS NULL OR rv.route_id = $2)
          AND ($3::int IS NULL OR rv.rating = $3)
          AND ($4::timestamptz IS NULL OR (rv.created_at, rv.id) < ($4::timestamptz, $5::uuid))
          AND ($7::uuid IS NULL OR rv.vehicle_id = $7)
        ORDER BY rv.created_at DESC, rv.id DESC
        LIMIT $6`,
      [
        requireTenantId(),
        input.routeId ?? null,
        input.rating ?? null,
        input.before?.createdAt ?? null,
        input.before?.id ?? null,
        input.limit,
        input.vehicleId ?? null,
      ],
      { name: 'review.listForOperator' },
    );
  }

  /** Star counts across the operator's published reviews, and how many still need an answer. */
  async operatorSummary(
    routeId?: string,
    vehicleId?: string,
  ): Promise<{ counts: Record<string, number>; unanswered: number; reported: number }> {
    const rows = await this.db.query<{
      rating: number;
      n: number;
      unanswered: number;
      reported: number;
    }>(
      `SELECT rating, count(*)::int AS n,
              count(*) FILTER (WHERE reply IS NULL)::int AS unanswered,
              count(*) FILTER (WHERE reported_at IS NOT NULL)::int AS reported
         FROM reviews WHERE tenant_id = $1 AND status = 'published' AND ($2::uuid IS NULL OR route_id = $2)
          AND ($3::uuid IS NULL OR vehicle_id = $3)
        GROUP BY rating`,
      [requireTenantId(), routeId ?? null, vehicleId ?? null],
      { name: 'review.operatorSummary' },
    );
    return {
      counts: Object.fromEntries(rows.map((r) => [String(r.rating), r.n])),
      unanswered: rows.reduce((a, r) => a + r.unanswered, 0),
      reported: rows.reduce((a, r) => a + r.reported, 0),
    };
  }

  async ratingsForOperator(routeId?: string, vehicleId?: string): Promise<number[]> {
    const rows = await this.db.query<{ rating: number }>(
      `SELECT rating FROM reviews WHERE tenant_id = $1 AND status = 'published' AND ($2::uuid IS NULL OR route_id = $2)
          AND ($3::uuid IS NULL OR vehicle_id = $3)`,
      [requireTenantId(), routeId ?? null, vehicleId ?? null],
      { name: 'review.ratingsForOperator' },
    );
    return rows.map((r) => Number(r.rating));
  }

  /** Set (or change) the operator's reply. Empty text removes it. False when the review is not this operator's. */
  async setReply(id: string, reply: string | null, by: string | null): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE reviews SET reply = $3, replied_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
              replied_by = CASE WHEN $3::text IS NULL THEN NULL ELSE $4::uuid END
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, reply, by],
      { name: 'review.setReply', primary: true },
    );
    return n > 0;
  }

  /** Report a review to the platform. Null when not this operator's; false when already reported. */
  async report(id: string, reason: string, by: string | null): Promise<boolean | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE reviews SET report_reason = $3, reported_at = now(), reported_by = $4
        WHERE tenant_id = $1 AND id = $2 AND reported_at IS NULL
       RETURNING id`,
      [requireTenantId(), id, reason, by],
      { name: 'review.report', primary: true },
    );
    if (row) return true;
    const exists = await this.db.queryOne(
      `SELECT 1 FROM reviews WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'review.exists', primary: true },
    );
    return exists ? false : null;
  }
}
