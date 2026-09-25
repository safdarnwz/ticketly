import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId } from '@kernel';

const ACTIVE = `('confirmed', 'completed')`;

/** Waitlist + forecast persistence. Joins the caller's transaction (locks behave exactly as before). */
@Injectable()
export class DemandRepository {
  constructor(private readonly db: DatabaseService) {}

  lockTrip(tripId: string) {
    return this.db.queryOne<{ route_id: string; status: string; departs_at: Date }>(
      `SELECT route_id, status::text AS status, departs_at FROM trips WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), tripId],
      { name: 'waitlist.lockTrip' },
    );
  }
  stopSequences(routeId: string, stopIds: string[]) {
    return this.db.query<{ stop_id: string; sequence: number }>(
      `SELECT stop_id, sequence FROM route_stops WHERE route_id = $1 AND stop_id = ANY($2::uuid[])`,
      [routeId, stopIds],
      { name: 'waitlist.seqs' },
    );
  }
  async availableSeats(tripId: string, fromSeq: number, toSeq: number): Promise<number> {
    return Number(
      (
        await this.db.queryOne<{ n: number }>(
          `SELECT trip_available_seats($1, $2, $3) AS n`,
          [tripId, fromSeq, toSeq],
          { name: 'waitlist.available' },
        )
      )?.n ?? 0,
    );
  }
  async waitingCount(tripId: string): Promise<number> {
    return Number(
      (
        await this.db.queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM trip_waitlist WHERE tenant_id = $1 AND trip_id = $2 AND status = 'waiting'`,
          [requireTenantId(), tripId],
          { name: 'waitlist.count' },
        )
      )?.n ?? 0,
    );
  }
  async insertEntry(e: {
    id: string;
    tripId: string;
    fromStopId: string;
    toStopId: string;
    fromSeq: number;
    toSeq: number;
    seatCount: number;
    contactPhone: string;
    contactEmail: string | null;
    customerId: string | null;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO trip_waitlist (id, tenant_id, trip_id, from_stop_id, to_stop_id, from_seq, to_seq, seat_count, contact_phone, contact_email, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        e.id,
        requireTenantId(),
        e.tripId,
        e.fromStopId,
        e.toStopId,
        e.fromSeq,
        e.toSeq,
        e.seatCount,
        e.contactPhone,
        e.contactEmail,
        e.customerId,
      ],
      { name: 'waitlist.insert' },
    );
  }
  cancelEntry(tripId: string, waitlistId: string, contactPhone: string): Promise<number> {
    return this.db.execute_(
      `UPDATE trip_waitlist SET status = 'cancelled' WHERE tenant_id = $1 AND trip_id = $2 AND id = $3 AND contact_phone = $4 AND status = 'waiting'`,
      [requireTenantId(), tripId, waitlistId, contactPhone],
      { name: 'waitlist.cancel' },
    );
  }
  listEntries(tripId: string) {
    return this.db.query(
      `SELECT w.id, w.seat_count AS "seatCount", w.contact_phone AS "contactPhone", w.status, w.notified_at AS "notifiedAt", w.created_at AS "createdAt",
              fs.name AS "fromStop", ts.name AS "toStop"
         FROM trip_waitlist w JOIN stops fs ON fs.id = w.from_stop_id JOIN stops ts ON ts.id = w.to_stop_id
        WHERE w.tenant_id = $1 AND w.trip_id = $2 ORDER BY w.created_at`,
      [requireTenantId(), tripId],
      { name: 'waitlist.list' },
    );
  }
  tripForNotify(tripId: string) {
    return this.db.queryOne<{
      status: string;
      departs_at: Date;
      journey_date: string;
      route_name: string;
    }>(
      `SELECT t.status::text AS status, t.departs_at, t.journey_date::text AS journey_date, r.name AS route_name
         FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'waitlist.trip' },
    );
  }
  async expireWaiting(tripId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE trip_waitlist SET status = 'expired' WHERE tenant_id = $1 AND trip_id = $2 AND status = 'waiting'`,
      [requireTenantId(), tripId],
      { name: 'waitlist.expire' },
    );
  }
  /** Oldest first; rows other transactions are notifying are skipped (never double-notified). */
  lockWaiting(tripId: string) {
    return this.db.query<{
      id: string;
      seat_count: number;
      from_seq: number;
      to_seq: number;
      contact_phone: string;
      contact_email: string | null;
    }>(
      `SELECT id, seat_count, from_seq, to_seq, contact_phone, contact_email FROM trip_waitlist
        WHERE tenant_id = $1 AND trip_id = $2 AND status = 'waiting' ORDER BY created_at FOR UPDATE SKIP LOCKED`,
      [requireTenantId(), tripId],
      { name: 'waitlist.lockWaiting' },
    );
  }
  async markNotified(ids: string[]): Promise<void> {
    await this.db.execute_(
      `UPDATE trip_waitlist SET status = 'notified', notified_at = now() WHERE id = ANY($1::uuid[])`,
      [ids],
      { name: 'waitlist.notified' },
    );
  }

  /* forecast */
  tripForForecast(tripId: string) {
    return this.db.queryOne<{
      service_id: string;
      departs_at: Date;
      total_seats: number;
      journey_date: string;
    }>(
      `SELECT service_id, departs_at, total_seats, journey_date::text AS journey_date FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'forecast.trip' },
    );
  }
  async seatsSold(tripId: string): Promise<number> {
    return Number(
      (
        await this.db.queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
        WHERE b.tenant_id = $1 AND bs.trip_id = $2 AND b.status IN ${ACTIVE}`,
          [requireTenantId(), tripId],
          { name: 'forecast.sold' },
        )
      )?.n ?? 0,
    );
  }
  /** Same service, last 8 weeks, departed/closed: final sold vs sold at the same lead time. */
  paceHistory(serviceId: string, excludeTripId: string, leadDays: number, journeyDate: string) {
    return this.db.query<{ final_sold: string; at_lead: string }>(
      `SELECT count(bs.*) FILTER (WHERE b.status IN ${ACTIVE}) AS final_sold,
              count(bs.*) FILTER (WHERE b.status IN ${ACTIVE} AND b.created_at <= p.departs_at - make_interval(days => $4)) AS at_lead
         FROM trips p
         LEFT JOIN booking_seats bs ON bs.trip_id = p.id
         LEFT JOIN bookings b ON b.id = bs.booking_id
        WHERE p.tenant_id = $1 AND p.service_id = $2 AND p.id <> $3 AND p.status IN ('departed', 'closed')
          AND p.journey_date BETWEEN ($5::date - 56) AND ($5::date - 1)
        GROUP BY p.id`,
      [requireTenantId(), serviceId, excludeTripId, leadDays, journeyDate],
      { name: 'forecast.history' },
    );
  }
  upcomingTrips(days: number) {
    return this.db.query<{ id: string; journey_date: string; route_name: string }>(
      `SELECT t.id, t.journey_date::text AS journey_date, r.name AS route_name FROM trips t JOIN routes r ON r.id = t.route_id
        WHERE t.tenant_id = $1 AND t.status IN ('scheduled', 'open') AND t.departs_at BETWEEN now() AND now() + make_interval(days => $2)
        ORDER BY t.departs_at LIMIT 300`,
      [requireTenantId(), days],
      { name: 'forecast.upcoming' },
    );
  }

  /** Trips the operator already decided a cancel suggestion for (#280). */
  async decidedCancelSuggestions(tripIds: string[]): Promise<Set<string>> {
    const rows = await this.db.query<{ trip_id: string }>(
      `SELECT trip_id FROM trip_suggestion_decisions
        WHERE tenant_id = $1 AND kind = 'cancel' AND trip_id = ANY($2::uuid[])`,
      [requireTenantId(), tripIds],
      { name: 'suggestion.decided' },
    );
    return new Set(rows.map((r) => r.trip_id));
  }

  async recordDecision(d: {
    tripId: string;
    decision: 'accepted' | 'rejected';
    reason: string;
    forecastPct: number | null;
    decidedBy: string | null;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO trip_suggestion_decisions (tenant_id, trip_id, kind, decision, reason, forecast_pct, decided_by)
       VALUES ($1, $2, 'cancel', $3, $4, $5, $6)
       ON CONFLICT (trip_id, kind) DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason,
         forecast_pct = EXCLUDED.forecast_pct, decided_by = EXCLUDED.decided_by, decided_at = now()`,
      [requireTenantId(), d.tripId, d.decision, d.reason, d.forecastPct, d.decidedBy],
      { name: 'suggestion.record', primary: true },
    );
  }
}
