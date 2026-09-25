import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';

/** A booking as the platform's live view lists it (contact details masked). */
export interface MonitoredBooking {
  id: string;
  pnr: string;
  tenantId: string;
  operatorName: string;
  operatorSlug: string;
  status: string;
  /** Held and the hold has not run out: a customer is paying right now. */
  liveHold: boolean;
  holdExpiresAt: Date | null;
  channel: string;
  soldBy: 'agent' | 'gds' | null;
  seatCount: number;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  departsAt: Date;
  from: string | null;
  to: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export type MonitoredStatus = 'all' | 'live' | 'confirmed' | 'cancelled' | 'expired' | 'completed';

export interface OperatorActivity {
  tenantId: string;
  operatorName: string;
  operatorSlug: string;
  operatorStatus: string;
  holdsLive: number;
  seatsOnHold: number;
  holdValueMinor: number;
  confirmed: number;
  seatsSold: number;
  grossMinor: number;
  cancelled: number;
  lastBookingAt: Date | null;
}

/** 98******21 — enough to recognise, not enough to call. */
export function maskPhone(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '').slice(-10);
  return d.length < 4
    ? '****'
    : `${d.slice(0, 2)}${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;
}

/** as***@example.in */
export function maskEmail(v: string | null): string | null {
  if (!v) return null;
  const [user, domain] = v.split('@');
  if (!domain) return '***';
  return `${(user ?? '').slice(0, 2)}***@${domain}`;
}

const STATUS_SQL: Record<MonitoredStatus, string> = {
  all: 'true',
  live: "b.status = 'held' AND b.hold_expires_at > now()",
  confirmed: "b.status = 'confirmed'",
  cancelled: "b.status = 'cancelled'",
  // A hold the sweeper has not reached yet is already over.
  expired: "(b.status = 'expired' OR (b.status = 'held' AND b.hold_expires_at <= now()))",
  completed: "b.status = 'completed'",
};

/**
 * Bookings across every operator, for the platform admin: what is being
 * booked right now (live holds), what was booked, by which operator. Read-only
 * and outside tenant isolation on purpose — only the platform-admin controller
 * uses it.
 */
@Injectable()
export class BookingMonitoringRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first; `before` is the (createdAt, id) of the last row of the previous page. */
  async feed(f: {
    tenantId?: string;
    status: MonitoredStatus;
    channel?: string;
    pnr?: string;
    fromInstant: Date;
    toInstant: Date;
    before?: { createdAt: string; id: string };
    limit: number;
  }): Promise<MonitoredBooking[]> {
    return this.uow.run(
      { name: 'bookingMonitoring.feed', bypassRls: true, readOnly: true },
      async (scope) => {
        const { rows } = await scope.client.query<{
          id: string;
          pnr: string;
          tenant_id: string;
          operator_name: string;
          operator_slug: string;
          status: string;
          live_hold: boolean;
          hold_expires_at: Date | null;
          channel: string;
          agent: boolean;
          gds: boolean;
          seat_count: number;
          total_minor: string;
          paid_minor: string;
          currency: string;
          created_at: Date;
          confirmed_at: Date | null;
          cancelled_at: Date | null;
          departs_at: Date;
          from_name: string | null;
          to_name: string | null;
          contact_phone: string | null;
          contact_email: string | null;
        }>(
          `SELECT b.id, b.pnr, b.tenant_id, t.display_name AS operator_name, t.slug AS operator_slug,
                  b.status, (b.status = 'held' AND b.hold_expires_at > now()) AS live_hold,
                  b.hold_expires_at, b.channel, b.agent_id IS NOT NULL AS agent,
                  b.gds_partner_id IS NOT NULL AS gds, b.seat_count, b.total_minor, b.paid_minor,
                  b.currency, b.created_at, b.confirmed_at, b.cancelled_at, tr.departs_at,
                  coalesce(fc.name, fs.name) AS from_name, coalesce(tc.name, ts.name) AS to_name,
                  b.contact_phone, b.contact_email
             FROM bookings b
             JOIN tenants t ON t.id = b.tenant_id
             JOIN trips tr ON tr.id = b.trip_id
             LEFT JOIN stops fs ON fs.id = b.from_stop_id
             LEFT JOIN cities fc ON fc.id = fs.city_id
             LEFT JOIN stops ts ON ts.id = b.to_stop_id
             LEFT JOIN cities tc ON tc.id = ts.city_id
            WHERE ($1::uuid IS NULL OR b.tenant_id = $1::uuid)
              AND ${STATUS_SQL[f.status]}
              AND ($2::text IS NULL OR b.channel = $2::text)
              AND ($3::text IS NULL OR b.pnr = $3::text)
              AND b.created_at >= $4 AND b.created_at < $5
              AND ($6::timestamptz IS NULL OR (b.created_at, b.id) < ($6::timestamptz, $7::uuid))
            ORDER BY b.created_at DESC, b.id DESC
            LIMIT $8`,
          [
            f.tenantId ?? null,
            f.channel ?? null,
            f.pnr ?? null,
            f.fromInstant,
            f.toInstant,
            f.before?.createdAt ?? null,
            f.before?.id ?? null,
            f.limit,
          ],
        );
        return rows.map((r) => ({
          id: r.id,
          pnr: r.pnr,
          tenantId: r.tenant_id,
          operatorName: r.operator_name,
          operatorSlug: r.operator_slug,
          status: r.status === 'held' && !r.live_hold ? 'expired' : r.status,
          liveHold: r.live_hold,
          holdExpiresAt: r.hold_expires_at,
          channel: r.channel,
          soldBy: r.agent ? 'agent' : r.gds ? 'gds' : null,
          seatCount: r.seat_count,
          totalMinor: Number(r.total_minor),
          paidMinor: Number(r.paid_minor),
          currency: r.currency,
          createdAt: r.created_at,
          confirmedAt: r.confirmed_at,
          cancelledAt: r.cancelled_at,
          departsAt: r.departs_at,
          from: r.from_name,
          to: r.to_name,
          contactPhone: maskPhone(r.contact_phone),
          contactEmail: maskEmail(r.contact_email),
        }));
      },
    );
  }

  /**
   * Per operator, for one period: holds in progress now, bookings confirmed
   * and cancelled in the period, seats and gross sold. Only operators with any
   * of that (or a live hold) are listed.
   */
  async activity(fromInstant: Date, toInstant: Date): Promise<OperatorActivity[]> {
    return this.uow.run(
      { name: 'bookingMonitoring.activity', bypassRls: true, readOnly: true },
      async (scope) => {
        const { rows } = await scope.client.query<{
          tenant_id: string;
          operator_name: string;
          operator_slug: string;
          operator_status: string;
          holds_live: string;
          seats_on_hold: string;
          hold_value: string;
          confirmed: string;
          seats_sold: string;
          gross: string;
          cancelled: string;
          last_booking_at: Date | null;
        }>(
          `WITH live AS (
             SELECT tenant_id, count(*) AS n, sum(seat_count) AS seats, sum(total_minor) AS value
               FROM bookings WHERE status = 'held' AND hold_expires_at > now()
              GROUP BY tenant_id),
           sold AS (
             SELECT tenant_id, count(*) AS n, sum(seat_count) AS seats, sum(paid_minor) AS gross
               FROM bookings WHERE confirmed_at >= $1 AND confirmed_at < $2
              GROUP BY tenant_id),
           gone AS (
             SELECT tenant_id, count(*) AS n
               FROM bookings WHERE cancelled_at >= $1 AND cancelled_at < $2
              GROUP BY tenant_id),
           active AS (
             SELECT tenant_id FROM live UNION SELECT tenant_id FROM sold UNION SELECT tenant_id FROM gone)
           SELECT t.id AS tenant_id, t.display_name AS operator_name, t.slug AS operator_slug,
                  t.status AS operator_status,
                  coalesce(live.n, 0) AS holds_live, coalesce(live.seats, 0) AS seats_on_hold,
                  coalesce(live.value, 0) AS hold_value, coalesce(sold.n, 0) AS confirmed,
                  coalesce(sold.seats, 0) AS seats_sold, coalesce(sold.gross, 0) AS gross,
                  coalesce(gone.n, 0) AS cancelled,
                  (SELECT max(b.created_at) FROM bookings b WHERE b.tenant_id = t.id) AS last_booking_at
             FROM active
             JOIN tenants t ON t.id = active.tenant_id
             LEFT JOIN live ON live.tenant_id = t.id
             LEFT JOIN sold ON sold.tenant_id = t.id
             LEFT JOIN gone ON gone.tenant_id = t.id
            ORDER BY coalesce(live.n, 0) DESC, coalesce(sold.gross, 0) DESC, t.display_name`,
          [fromInstant, toInstant],
        );
        return rows.map((r) => ({
          tenantId: r.tenant_id,
          operatorName: r.operator_name,
          operatorSlug: r.operator_slug,
          operatorStatus: r.operator_status,
          holdsLive: Number(r.holds_live),
          seatsOnHold: Number(r.seats_on_hold),
          holdValueMinor: Number(r.hold_value),
          confirmed: Number(r.confirmed),
          seatsSold: Number(r.seats_sold),
          grossMinor: Number(r.gross),
          cancelled: Number(r.cancelled),
          lastBookingAt: r.last_booking_at,
        }));
      },
    );
  }
}
