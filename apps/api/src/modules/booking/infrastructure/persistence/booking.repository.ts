import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService, UnitOfWork } from '@database';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type BookingId,
  type RouteId,
  type StopId,
  type TripId,
  type UserId,
} from '@kernel';

import type { BookingStatus } from '../../domain/booking-state';
import type { LockedSeat } from './seat-lock.repository';

/** One passenger on a trip's chart. */
export interface TripOccupant {
  seatNumber: string;
  name: string;
  age: number | null;
  gender: string | null;
  bookingId: string;
  pnr: string;
  status: string;
  /** Held: the customer is paying right now. */
  onHold: boolean;
  holdExpiresAt: Date | null;
  fromSeq: number;
  toSeq: number;
  contactPhone: string | null;
  channel: string;
  /** issued / boarded / no_show / cancelled. */
  ticketStatus: string | null;
}

/** A booking as the operator's bookings list shows it. */
export interface StaffBookingRow {
  id: string;
  pnr: string;
  status: string;
  liveHold: boolean;
  holdExpiresAt: Date | null;
  totalMinor: number;
  paidMinor: number;
  seatCount: number;
  contactPhone: string | null;
  contactEmail: string | null;
  channel: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  tripId: string;
  journeyDate: string;
  departsAt: Date;
  routeName: string;
  fromName: string | null;
  toName: string | null;
  leadPassenger: string | null;
  seats: string[];
  agentName: string | null;
  noShowSeats: string[];
}

export interface BookingRow {
  id: BookingId;
  pnr: string;
  tripId: TripId;
  routeId: RouteId;
  fromSeq: number;
  toSeq: number;
  status: BookingStatus;
  seatCount: number;
  customerId: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  taxMinor: number;
  couponCode: string | null;
  holdExpiresAt: Date | null;
  version: number;
  contactPhone: string | null;
  contactEmail: string | null;
  /** Only populated by cross-tenant reads (`listForCustomer`, `getByPnr`) — not selected elsewhere. */
  tenantId?: string;
  createdAt?: Date;
}

/**
 * Booking persistence. Write methods assume an open transaction (they use the
 * unit-of-work client so the whole saga is atomic with the seat lock).
 */
@Injectable()
export class BookingRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Insert a held booking with its seats and passengers. Returns the id. */
  async insertHeld(input: {
    pnr: string;
    tripId: TripId;
    routeId: RouteId;
    fromSeq: number;
    toSeq: number;
    fromStopId: StopId;
    toStopId: StopId;
    channel: string;
    customerId: UserId | null;
    /** Staff member who sold it at the counter. */
    bookedBy?: string | null;
    contactEmail?: string;
    contactPhone?: string;
    currency: string;
    baseMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    couponCode: string | null;
    quoteId: string;
    fareBreakup: unknown;
    holdExpiresAt: Date;
    seats: (LockedSeat & { fareMinor: number })[];
    passengers: {
      seatNumber: string;
      fullName: string;
      age?: number;
      gender?: string;
      category?: string;
      idProof?: string;
    }[];
    infants?: { fullName: string; age: number; guardianSeat: string; feeMinor: number }[];
  }): Promise<BookingId> {
    const tx = currentTransaction();
    if (!tx) throw new Error('insertHeld requires a transaction');
    const tenantId = requireTenantId();
    const id = newId() as BookingId;

    await tx.client.query(
      `INSERT INTO bookings
         (id, tenant_id, pnr, trip_id, route_id, from_seq, to_seq, from_stop_id, to_stop_id,
          channel, status, customer_id, contact_email, contact_phone, seat_count, currency,
          base_minor, discount_minor, tax_minor, total_minor, coupon_code, quote_id,
          fare_breakup, hold_expires_at, booked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'held',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        id,
        tenantId,
        input.pnr,
        input.tripId,
        input.routeId,
        input.fromSeq,
        input.toSeq,
        input.fromStopId,
        input.toStopId,
        input.channel,
        input.customerId ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.seats.length,
        input.currency,
        input.baseMinor,
        input.discountMinor,
        input.taxMinor,
        input.totalMinor,
        input.couponCode,
        input.quoteId,
        JSON.stringify(input.fareBreakup),
        input.holdExpiresAt,
        input.bookedBy ?? null,
      ],
    );

    // One statement per table (unnest), not one per seat/passenger: a 6-seat
    // booking is 3 round-trips inside the hold transaction instead of 13, so
    // seat row-locks are held for a fraction of the time.
    await tx.client.query(
      `INSERT INTO booking_seats (booking_id, tenant_id, trip_id, seat_number, leg_mask, fare_minor)
       SELECT $1, $2, $3, s.seat_number, s.leg_mask, s.fare_minor
         FROM unnest($4::text[], $5::bigint[], $6::bigint[]) AS s(seat_number, leg_mask, fare_minor)`,
      [
        id,
        tenantId,
        input.tripId,
        input.seats.map((x) => x.seatNumber),
        input.seats.map((x) => x.legMask.toString()),
        input.seats.map((x) => x.fareMinor),
      ],
    );
    if (input.passengers.length > 0) {
      await tx.client.query(
        `INSERT INTO passengers (id, booking_id, tenant_id, seat_number, full_name, age, gender, category, id_proof)
         SELECT p.id, $1, $2, p.seat_number, p.full_name, p.age, p.gender, p.category, p.id_proof
           FROM unnest($3::uuid[], $4::text[], $5::text[], $6::smallint[], $7::text[], $8::text[], $9::text[]) AS p(id, seat_number, full_name, age, gender, category, id_proof)`,
        [
          id,
          tenantId,
          input.passengers.map(() => newId()),
          input.passengers.map((p) => p.seatNumber),
          input.passengers.map((p) => p.fullName),
          input.passengers.map((p) => p.age ?? null),
          input.passengers.map((p) => p.gender ?? null),
          input.passengers.map((p) => p.category ?? 'adult'),
          input.passengers.map((p) => p.idProof?.trim() || null),
        ],
      );
    }
    if (input.infants?.length) {
      await tx.client.query(
        `INSERT INTO booking_infants (booking_id, tenant_id, full_name, age, guardian_seat, fee_minor)
         SELECT $1, $2, i.full_name, i.age, i.guardian_seat, i.fee_minor FROM unnest($3::text[], $4::smallint[], $5::text[], $6::bigint[]) AS i(full_name, age, guardian_seat, fee_minor)`,
        [
          id,
          tenantId,
          input.infants.map((i) => i.fullName.trim()),
          input.infants.map((i) => i.age),
          input.infants.map((i) => i.guardianSeat.trim()),
          input.infants.map((i) => i.feeMinor),
        ],
      );
    }
    return id;
  }

  /**
   * Staff search (415–417): by PNR, mobile (last 10 digits, so +91 / 0 prefixes
   * match) or ticket/boarding code. Newest first, max 50.
   */
  /**
   * The operator's bookings, newest first. By PNR / mobile / ticket number
   * (any date), or by period (booking or journey date, in the operator's own
   * time zone) narrowed by status, channel and trip. `before` pages on
   * (createdAt, id). The agent portal uses it with `agentId`.
   */
  async search(q: {
    pnr?: string;
    mobile?: string;
    ticket?: string;
    agentId?: string;
    from?: string;
    to?: string;
    dateBasis?: 'booked' | 'journey';
    status?: 'live' | 'confirmed' | 'cancelled' | 'expired' | 'completed';
    channel?: string;
    tripId?: string;
    noShow?: boolean;
    branchId?: string;
    before?: { createdAt: string; id: string };
    limit?: number;
  }): Promise<StaffBookingRow[]> {
    const digits = (q.mobile ?? '').replace(/\D/g, '').slice(-10);
    const status = {
      live: "b.status = 'held' AND b.hold_expires_at > now()",
      confirmed: "b.status = 'confirmed'",
      cancelled: "b.status = 'cancelled'",
      expired: "(b.status = 'expired' OR (b.status = 'held' AND b.hold_expires_at <= now()))",
      completed: "b.status = 'completed'",
    }[q.status ?? 'confirmed'];
    const onDate =
      q.dateBasis === 'journey'
        ? 't.journey_date'
        : '(b.created_at AT TIME ZONE te.timezone)::date';
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT b.id, b.pnr, b.status, (b.status = 'held' AND b.hold_expires_at > now()) AS "liveHold",
              b.hold_expires_at AS "holdExpiresAt", b.total_minor AS "totalMinor", b.paid_minor AS "paidMinor",
              b.seat_count AS "seatCount", b.contact_phone AS "contactPhone", b.contact_email AS "contactEmail",
              b.channel, b.created_at AS "createdAt", b.confirmed_at AS "confirmedAt",
              b.cancelled_at AS "cancelledAt", b.trip_id AS "tripId", t.journey_date AS "journeyDate",
              t.departs_at AS "departsAt", r.name AS "routeName",
              fs.name AS "fromName", ts.name AS "toName",
              (SELECT p.full_name FROM passengers p WHERE p.booking_id = b.id ORDER BY p.seat_number LIMIT 1) AS "leadPassenger",
              (SELECT array_agg(bs.seat_number ORDER BY bs.seat_number) FROM booking_seats bs WHERE bs.booking_id = b.id) AS seats,
              ag.name AS "agentName",
              (SELECT array_agg(tk.seat_number ORDER BY tk.seat_number) FROM tickets tk WHERE tk.booking_id = b.id AND tk.status = 'no_show') AS "noShowSeats"
         FROM bookings b
         LEFT JOIN agents ag ON ag.id = b.agent_id AND ag.tenant_id = b.tenant_id
         JOIN tenants te ON te.id = b.tenant_id
         JOIN trips t ON t.id = b.trip_id
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN stops fs ON fs.id = b.from_stop_id
         LEFT JOIN stops ts ON ts.id = b.to_stop_id
        WHERE b.tenant_id = $1
          AND ($2::text IS NULL OR upper(b.pnr) = upper($2))
          AND ($3::text IS NULL OR right(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g'), 10) = $3)
          AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.booking_id = b.id AND upper(tk.boarding_code) = upper($4)))
          AND ($5::uuid IS NULL OR b.agent_id = $5)
          AND ($6::date IS NULL OR ${onDate} >= $6::date)
          AND ($7::date IS NULL OR ${onDate} <= $7::date)
          AND ($8::boolean OR ${status})
          AND ($9::text IS NULL OR b.channel = $9)
          AND ($10::uuid IS NULL OR b.trip_id = $10)
          AND (NOT $14::boolean OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.booking_id = b.id AND tk.status = 'no_show'))
          AND ($15::uuid IS NULL OR EXISTS (SELECT 1 FROM users su WHERE su.id = b.booked_by AND su.tenant_id = b.tenant_id AND su.branch_id = $15)
               OR (ag.id IS NOT NULL AND ag.branch_id = $15))
          AND ($11::timestamptz IS NULL OR (b.created_at, b.id) < ($11::timestamptz, $12::uuid))
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $13`,
      [
        requireTenantId(),
        q.pnr?.trim() || null,
        digits.length === 10 ? digits : null,
        q.ticket?.trim() || null,
        q.agentId ?? null,
        q.from ?? null,
        q.to ?? null,
        !q.status,
        q.channel ?? null,
        q.tripId ?? null,
        q.before?.createdAt ?? null,
        q.before?.id ?? null,
        Math.min(q.limit ?? 50, 201),
        q.noShow ?? false,
        q.branchId ?? null,
      ],
      { name: 'booking.search' },
    );
    return rows.map((r) => ({
      ...(r as unknown as StaffBookingRow),
      status: r.status === 'held' && !r.liveHold ? 'expired' : (r.status as string),
      totalMinor: Number(r.totalMinor),
      paidMinor: Number(r.paidMinor),
      seats: (r.seats as string[] | null) ?? [],
      noShowSeats: (r.noShowSeats as string[] | null) ?? [],
    }));
  }

  /**
   * Everyone on a trip, seat by seat: paid bookings and holds being paid for
   * right now, with the part of the route each one travels.
   */
  async tripOccupants(tripId: string): Promise<TripOccupant[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT p.seat_number AS "seatNumber", p.full_name AS "name", p.age, p.gender,
              b.id AS "bookingId", b.pnr, b.status, (b.status = 'held') AS "onHold",
              b.hold_expires_at AS "holdExpiresAt", b.from_seq AS "fromSeq", b.to_seq AS "toSeq",
              b.contact_phone AS "contactPhone", b.channel, tk.status AS "ticketStatus"
         FROM passengers p
         JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN tickets tk ON tk.booking_id = b.id AND tk.seat_number = p.seat_number
        WHERE b.tenant_id = $1 AND b.trip_id = $2
          AND (b.status IN ('confirmed', 'completed') OR (b.status = 'held' AND b.hold_expires_at > now()))
        ORDER BY b.from_seq, p.seat_number`,
      [requireTenantId(), tripId],
      { name: 'booking.tripOccupants' },
    );
    return rows as unknown as TripOccupant[];
  }

  /** The signed-in operator's time zone (its calendar day is "today"). */
  async operatorTimezone(): Promise<string> {
    const row = await this.db.queryOne<{ timezone: string }>(
      `SELECT timezone FROM tenants WHERE id = $1`,
      [requireTenantId()],
      { name: 'booking.operatorTimezone' },
    );
    return row?.timezone ?? 'Asia/Kolkata';
  }

  async channelOf(bookingId: BookingId): Promise<string | null> {
    const row = await this.db.queryOne<{ channel: string }>(
      `SELECT channel FROM bookings WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), bookingId],
      { name: 'booking.channelOf' },
    );
    return row?.channel ?? null;
  }

  async findForUpdate(id: BookingId): Promise<BookingRow | null> {
    const tx = currentTransaction();
    const runner = tx
      ? (sql: string, params: unknown[]) =>
          tx.client.query<BookingRow>(sql, params).then((r) => r.rows[0] ?? null)
      : (sql: string, params: unknown[]) =>
          this.db.queryOne<BookingRow>(sql, params, { name: 'booking.find', primary: true });
    const lock = tx ? ' FOR UPDATE' : '';
    return runner(
      `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
              status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
              tax_minor AS "taxMinor", coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version,
              contact_phone AS "contactPhone", contact_email AS "contactEmail"
         FROM bookings WHERE tenant_id = $1 AND id = $2${lock}`,
      [requireTenantId(), id],
    );
  }

  /**
   * Look up a booking by PNR — used from `www.ticketly.com`, which has NO
   * bound tenant (see migration 0018 / docs/ACCOUNTS_ONBOARDING.md), so this
   * CANNOT filter by `requireTenantId()` like every other read here. Two
   * consequences of that:
   *
   *  1. PNR is only unique PER TENANT (`UNIQUE(tenant_id, pnr)`, see
   *     0007_booking.sql) — two different operators can mint the identical
   *     PNR string. `contactPhone` is REQUIRED to disambiguate, exactly like
   *     real-world OTAs (RedBus/IRCTC) require PNR + a second identity fact.
   *     It also stops a stranger who merely guesses/knows a PNR from seeing
   *     someone else's booking.
   *  2. Reading across tenants needs `bypassRls` — the normal per-request GUC
   *     binding only ever grants access to ONE tenant's rows.
   */
  async getByPnr(pnr: string, contactPhone: string): Promise<BookingRow> {
    const row = await this.uow.run<BookingRow | null>(
      { name: 'booking.getByPnr', bypassRls: true },
      async (scope) => {
        const result = await scope.client.query<BookingRow>(
          `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
                  status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
                  coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version, tenant_id AS "tenantId"
             FROM bookings WHERE pnr = $1 AND contact_phone = $2
             LIMIT 1`,
          [pnr.trim().toUpperCase(), contactPhone.trim()],
        );
        return result.rows[0] ?? null;
      },
    );
    if (!row) throw new NotFoundError('Booking', pnr);
    return row;
  }

  /** Staff/ops lookup by PNR ALONE — no phone-match, unlike getByPnr's customer-self-service version. Gated by a permission check at the controller, not by requiring information a staff member may not have on hand. Same cross-tenant bypassRls reasoning: a PNR alone doesn't say which operator issued it. */
  /** A PNR in the caller's own operator only — PNRs are unique per operator, not globally. */
  async findByPnrStaff(pnr: string): Promise<BookingRow | null> {
    const tenantId = requireTenantId();
    return this.uow.run<BookingRow | null>(
      { name: 'booking.findByPnrStaff', tenantId, readOnly: true },
      async (scope) => {
        const result = await scope.client.query<BookingRow>(
          `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
                status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
                coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version, tenant_id AS "tenantId"
           FROM bookings WHERE pnr = $1 AND tenant_id = $2
           LIMIT 1`,
          [pnr.trim().toUpperCase(), tenantId],
        );
        return result.rows[0] ?? null;
      },
    );
  }

  /** A signed-in customer's own bookings, across every operator, newest first. */
  async listForCustomer(customerId: string): Promise<BookingRow[]> {
    return this.uow.run<BookingRow[]>(
      { name: 'booking.listForCustomer', bypassRls: true, readOnly: true },
      async (scope) => {
        const result = await scope.client.query<BookingRow>(
          `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
                status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
                coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version, tenant_id AS "tenantId",
                created_at AS "createdAt"
           FROM bookings WHERE customer_id = $1 AND status <> 'held'
          ORDER BY created_at DESC LIMIT 200`,
          [customerId],
        );
        return result.rows;
      },
    );
  }

  /**
   * Let go of an unpaid hold early (the customer went back to change seats),
   * exactly as the expiry sweeper does. Only the holder: the booking's
   * customer or its contact mobile. The status re-check makes a payment that
   * confirmed it a moment earlier win — a confirmed booking is never touched.
   */
  async releaseHold(
    bookingId: string,
    who: { customerId?: string; mobileDigits?: string },
  ): Promise<boolean> {
    return this.uow.run({ name: 'booking.releaseHold', bypassRls: true }, async (scope) => {
      const r = await scope.client.query(
        `UPDATE bookings SET status = 'expired', updated_at = now()
          WHERE id = $1 AND status = 'held'
            AND (($2::uuid IS NOT NULL AND customer_id = $2::uuid)
                 OR ($3::text IS NOT NULL AND right(regexp_replace(coalesce(contact_phone, ''), '\\D', '', 'g'), 10) = $3))`,
        [bookingId, who.customerId ?? null, who.mobileDigits ?? null],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  /** Who may see a booking's tickets: its operator, its customer, its contact phone. */
  async accessInfo(
    bookingId: string,
  ): Promise<{ tenantId: string; customerId: string | null; contactPhone: string | null } | null> {
    return this.uow.run(
      { name: 'booking.accessInfo', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<{
          tenant_id: string;
          customer_id: string | null;
          contact_phone: string | null;
        }>(`SELECT tenant_id, customer_id, contact_phone FROM bookings WHERE id = $1`, [bookingId]);
        const row = r.rows[0];
        return row
          ? {
              tenantId: row.tenant_id,
              customerId: row.customer_id,
              contactPhone: row.contact_phone,
            }
          : null;
      },
    );
  }

  async verifyOwnership(
    bookingId: string,
    contactPhone: string,
  ): Promise<{ tenantId: string } | null> {
    return this.uow.run<{ tenantId: string } | null>(
      { name: 'booking.verifyOwnership', bypassRls: true },
      async (scope) => {
        const result = await scope.client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM bookings WHERE id = $1 AND contact_phone = $2 LIMIT 1`,
          [bookingId, contactPhone.trim()],
        );
        return result.rows[0] ? { tenantId: result.rows[0].tenant_id } : null;
      },
    );
  }

  /**
   * Platform-admin dashboard numbers for ONE operator — total/today bookings,
   * total/today cancellations, total revenue. `confirmed_at`/`cancelled_at`
   * (not `created_at` + current `status`) are the source of truth for WHEN
   * something happened, since a booking's `status` only reflects where it is
   * NOW (e.g. a same-day booking that's later cancelled must still count
   * toward "today's bookings" — it WAS confirmed today, even though its
   * status is now 'cancelled'). Called from the super-admin surface, which
   * has no tenant of its own, so this runs with `bypassRls` for the one
   * tenant being inspected.
   */
  /**
   * An operator's headline numbers. "Today" is the operator's own calendar
   * day (its time zone), not the database server's.
   */
  async statsForTenant(tenantId: string): Promise<{
    totalBookings: number;
    todayBookings: number;
    todaySeats: number;
    todayRevenueMinor: number;
    totalCancelled: number;
    todayCancelled: number;
    totalRevenueMinor: number;
    liveHolds: number;
    liveHoldSeats: number;
  }> {
    return this.uow.run(
      { name: 'booking.statsForTenant', bypassRls: true, readOnly: true },
      async (scope) => {
        const row = await scope.client.query<Record<string, string>>(
          `WITH day AS (
             SELECT (date_trunc('day', now() AT TIME ZONE timezone) AT TIME ZONE timezone) AS starts
               FROM tenants WHERE id = $1)
           SELECT
             count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS total_bookings,
             count(*) FILTER (WHERE confirmed_at >= day.starts) AS today_bookings,
             coalesce(sum(seat_count) FILTER (WHERE confirmed_at >= day.starts), 0) AS today_seats,
             coalesce(sum(paid_minor) FILTER (WHERE confirmed_at >= day.starts AND status IN ('confirmed','completed')), 0) AS today_revenue_minor,
             count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS total_cancelled,
             count(*) FILTER (WHERE cancelled_at >= day.starts) AS today_cancelled,
             coalesce(sum(paid_minor) FILTER (WHERE status IN ('confirmed','completed')), 0) AS total_revenue_minor,
             count(*) FILTER (WHERE status = 'held' AND hold_expires_at > now()) AS live_holds,
             coalesce(sum(seat_count) FILTER (WHERE status = 'held' AND hold_expires_at > now()), 0) AS live_hold_seats
           FROM bookings, day WHERE tenant_id = $1`,
          [tenantId],
        );
        const r = row.rows[0] ?? {};
        const n = (k: string) => Number(r[k] ?? 0);
        return {
          totalBookings: n('total_bookings'),
          todayBookings: n('today_bookings'),
          todaySeats: n('today_seats'),
          todayRevenueMinor: n('today_revenue_minor'),
          totalCancelled: n('total_cancelled'),
          todayCancelled: n('today_cancelled'),
          totalRevenueMinor: n('total_revenue_minor'),
          liveHolds: n('live_holds'),
          liveHoldSeats: n('live_hold_seats'),
        };
      },
    );
  }

  /** Passenger names by seat — for e-ticket/invoice rendering (a passenger's name must appear on their own ticket). */
  async loadPassengers(
    bookingId: BookingId,
  ): Promise<
    { seatNumber: string; fullName: string; age: number | null; gender: string | null }[]
  > {
    return this.db.query(
      `SELECT seat_number AS "seatNumber", full_name AS "fullName", age, gender FROM passengers WHERE tenant_id = $1 AND booking_id = $2`,
      [requireTenantId(), bookingId],
      { name: 'booking.loadPassengers' },
    );
  }

  async loadSeats(bookingId: BookingId): Promise<LockedSeat[]> {
    const rows = await this.db.query<{ seat_number: string; leg_mask: string }>(
      `SELECT seat_number, leg_mask FROM booking_seats WHERE booking_id = $1`,
      [bookingId],
      { name: 'booking.loadSeats', primary: true },
    );
    return rows.map((r) => ({ seatNumber: r.seat_number, legMask: BigInt(r.leg_mask) }));
  }

  /** Same as loadSeats, but with each seat's actual fare — needed to compute an EXACT (not evenly-split) proportional refund when cancelling only SOME seats of a multi-seat booking. */
  async loadSeatsWithFare(
    bookingId: BookingId,
  ): Promise<{ seatNumber: string; legMask: bigint; fareMinor: number }[]> {
    const rows = await this.db.query<{ seat_number: string; leg_mask: string; fare_minor: string }>(
      `SELECT seat_number, leg_mask, fare_minor FROM booking_seats WHERE booking_id = $1`,
      [bookingId],
      { name: 'booking.loadSeatsWithFare', primary: true },
    );
    return rows.map((r) => ({
      seatNumber: r.seat_number,
      legMask: BigInt(r.leg_mask),
      fareMinor: Number(r.fare_minor),
    }));
  }

  /** Removes specific seats from a booking (partial cancellation) — the booking_seats rows, matching passengers rows, and marks their tickets 'cancelled'. Never touches the OTHER seats still on this booking. */
  async removeSeatsPartial(bookingId: BookingId, seatNumbers: string[]): Promise<void> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `DELETE FROM booking_seats WHERE tenant_id = $1 AND booking_id = $2 AND seat_number = ANY($3)`,
      [tenantId, bookingId, seatNumbers],
      { name: 'booking.removeSeatsPartial.seats', primary: true },
    );
    await this.db.execute_(
      `DELETE FROM passengers WHERE tenant_id = $1 AND booking_id = $2 AND seat_number = ANY($3)`,
      [tenantId, bookingId, seatNumbers],
      { name: 'booking.removeSeatsPartial.passengers', primary: true },
    );
    await this.db.execute_(
      `UPDATE tickets SET status = 'cancelled' WHERE tenant_id = $1 AND booking_id = $2 AND seat_number = ANY($3)`,
      [tenantId, bookingId, seatNumbers],
      { name: 'booking.removeSeatsPartial.tickets', primary: true },
    );
    // The booking's seat count follows its seats — occupancy, the bookings
    // list and the dashboard all read it.
    await this.db.execute_(
      `UPDATE bookings SET seat_count = (SELECT count(*) FROM booking_seats WHERE booking_id = $2), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, bookingId],
      { name: 'booking.removeSeatsPartial.count', primary: true },
    );
  }

  /** Adjusts a booking's totals after a partial-seat cancellation — never touched by a full cancel (which sets status instead). */
  async reduceTotals(
    bookingId: BookingId,
    fareDeltaMinor: number,
    taxDeltaMinor: number,
    paidDeltaMinor: number,
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE bookings SET total_minor = total_minor - $3, tax_minor = tax_minor - $4, paid_minor = paid_minor - $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), bookingId, fareDeltaMinor + taxDeltaMinor, taxDeltaMinor, paidDeltaMinor],
      { name: 'booking.reduceTotals', primary: true },
    );
  }

  /** The trip's passenger list (confirmed bookings) for the conductor. */
  manifest(tripId: TripId): Promise<unknown[]> {
    return this.db.query(
      `SELECT p.seat_number AS "seatNumber", p.full_name AS "fullName", p.age, p.gender,
              b.pnr, b.contact_phone AS "contactPhone", b.from_stop_id AS "fromStopId", b.to_stop_id AS "toStopId",
              fs.name AS "boardingPoint", ts.name AS "droppingPoint", b.from_seq AS "fromSeq",
              fts.departs_at AS "boardsAt", t.id AS "ticketId", t.status AS "ticketStatus",
              coalesce(st.ladies_only, false) AS "ladiesSeat"
         FROM passengers p
         JOIN bookings b ON b.id = p.booking_id AND b.status = 'confirmed'
         LEFT JOIN tickets t ON t.booking_id = b.id AND t.seat_number = p.seat_number
         LEFT JOIN stops fs ON fs.id = b.from_stop_id
         LEFT JOIN stops ts ON ts.id = b.to_stop_id
         LEFT JOIN trip_stops fts ON fts.trip_id = b.trip_id AND fts.sequence = b.from_seq
         LEFT JOIN trip_seats st ON st.trip_id = b.trip_id AND st.seat_number = p.seat_number
        WHERE p.tenant_id = $1 AND b.trip_id = $2
        ORDER BY b.from_seq, p.seat_number`,
      [requireTenantId(), tripId],
      { name: 'booking.manifest' },
    );
  }

  /** A ticket by id (the crew app boards from the manifest after checking the PNR), row-locked. */
  lockTicketById(ticketId: string): Promise<{
    id: string;
    tripId: string;
    seatNumber: string;
    status: string;
    bookingStatus: string;
    passengerName: string | null;
  } | null> {
    return this.db.queryOne(
      `SELECT tk.id, tk.trip_id AS "tripId", tk.seat_number AS "seatNumber", tk.status,
              b.status AS "bookingStatus", p.full_name AS "passengerName"
         FROM tickets tk
         JOIN bookings b ON b.id = tk.booking_id
         LEFT JOIN passengers p ON p.booking_id = b.id AND p.seat_number = tk.seat_number
        WHERE tk.tenant_id = $1 AND tk.id = $2
        FOR UPDATE OF tk`,
      [requireTenantId(), ticketId],
      { name: 'booking.lockTicketById', primary: true },
    );
  }

  /** The ticket with this boarding code, row-locked, with its booking's status and passenger. */
  lockTicketByBoardingCode(boardingCode: string): Promise<{
    id: string;
    tripId: string;
    seatNumber: string;
    status: string;
    bookingStatus: string;
    passengerName: string | null;
  } | null> {
    return this.db.queryOne(
      `SELECT tk.id, tk.trip_id AS "tripId", tk.seat_number AS "seatNumber", tk.status,
              b.status AS "bookingStatus", p.full_name AS "passengerName"
         FROM tickets tk
         JOIN bookings b ON b.id = tk.booking_id
         LEFT JOIN passengers p ON p.booking_id = b.id AND p.seat_number = tk.seat_number
        WHERE tk.tenant_id = $1 AND tk.boarding_code = $2
        FOR UPDATE OF tk`,
      [requireTenantId(), boardingCode],
      { name: 'booking.lockTicketByCode', primary: true },
    );
  }

  async lockTicketStatus(ticketId: string): Promise<string | null> {
    return (await this.lockTicket(ticketId))?.status ?? null;
  }

  /** The ticket (locked), whether its bus's departure time has passed, and by how many minutes. */
  async lockTicket(
    ticketId: string,
  ): Promise<{ status: string; departed: boolean; minutesSinceDeparture: number } | null> {
    return this.db.queryOne<{ status: string; departed: boolean; minutesSinceDeparture: number }>(
      `SELECT tk.status, (t.departs_at <= now()) AS departed,
              floor(extract(epoch FROM now() - t.departs_at) / 60)::int AS "minutesSinceDeparture"
         FROM tickets tk JOIN trips t ON t.id = tk.trip_id
        WHERE tk.tenant_id = $1 AND tk.id = $2 FOR UPDATE OF tk`,
      [requireTenantId(), ticketId],
      { name: 'booking.lockTicket', primary: true },
    );
  }

  async setTicketStatus(ticketId: string, status: 'boarded' | 'no_show'): Promise<void> {
    await this.db.execute_(
      `UPDATE tickets SET status = $3,
              boarded_at = CASE WHEN $3 = 'boarded' THEN now() ELSE boarded_at END
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), ticketId, status],
      { name: 'booking.setTicketStatus', primary: true },
    );
  }

  /** Phone booking: move the release time of a booking that is still held. */
  async setHoldExpiry(bookingId: BookingId, holdUntil: Date): Promise<void> {
    await this.db.execute_(
      `UPDATE bookings SET hold_expires_at = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'held'`,
      [requireTenantId(), bookingId, holdUntil],
      { name: 'booking.setHoldExpiry', primary: true },
    );
  }

  /** Adds charges (e.g. add-ons) and their tax to a booking's totals before payment. */
  async increaseTotals(bookingId: BookingId, amountMinor: number, taxMinor: number): Promise<void> {
    await this.db.execute_(
      `UPDATE bookings SET total_minor = total_minor + $3, tax_minor = tax_minor + $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), bookingId, amountMinor, taxMinor],
      { name: 'booking.increaseTotals', primary: true },
    );
  }

  /** The REAL tickets table (post-confirm) — has actual DB ids, unlike loadSeats (booking_seats, hold-time only, no ticket id). Used wherever a caller needs to reference a SPECIFIC ticket, e.g. the seat-upgrade flow. */
  async listTickets(bookingId: BookingId): Promise<{ id: string; seatNumber: string }[]> {
    return this.db.query(
      `SELECT id, seat_number AS "seatNumber" FROM tickets WHERE tenant_id = $1 AND booking_id = $2 ORDER BY seat_number`,
      [requireTenantId(), bookingId],
      { name: 'booking.listTickets' },
    );
  }

  async setStatus(
    id: BookingId,
    status: BookingStatus,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const tx = currentTransaction();
    const setters = ['status = $3', 'version = version + 1', 'updated_at = now()'];
    const params: unknown[] = [requireTenantId(), id, status];
    if (status === 'confirmed') setters.push('confirmed_at = now()');
    if (status === 'cancelled') setters.push('cancelled_at = now()');
    if (extra.paidMinor !== undefined) {
      params.push(extra.paidMinor);
      setters.push(`paid_minor = $${params.length}`);
    }
    const sql = `UPDATE bookings SET ${setters.join(', ')} WHERE tenant_id = $1 AND id = $2`;
    if (tx) await tx.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'booking.setStatus', primary: true });
  }

  async issueTickets(
    bookingId: BookingId,
    tripId: TripId,
    tickets: { seatNumber: string; boardingCode: string }[],
  ): Promise<void> {
    const tx = currentTransaction();
    if (!tx) throw new Error('issueTickets requires a transaction');
    const tenantId = requireTenantId();
    if (tickets.length === 0) return;
    await tx.client.query(
      `INSERT INTO tickets (id, tenant_id, booking_id, trip_id, seat_number, boarding_code)
       SELECT t.id, $1, $2, $3, t.seat_number, t.boarding_code
         FROM unnest($4::uuid[], $5::text[], $6::text[]) AS t(id, seat_number, boarding_code)`,
      [
        tenantId,
        bookingId,
        tripId,
        tickets.map(() => newId()),
        tickets.map((t) => t.seatNumber),
        tickets.map((t) => t.boardingCode),
      ],
    );
  }

  async recordCancellation(input: {
    bookingId: BookingId;
    reason: string | null;
    refundPct: number;
    paidMinor: number;
    feeMinor: number;
    refundMinor: number;
    cancelledBy: UserId | null;
  }): Promise<string> {
    const tx = currentTransaction();
    if (!tx) throw new Error('recordCancellation requires a transaction');
    const id = newId();
    await tx.client.query(
      `INSERT INTO cancellations (id, tenant_id, booking_id, reason, refund_pct, paid_minor, fee_minor, refund_minor, cancelled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        requireTenantId(),
        input.bookingId,
        input.reason,
        input.refundPct,
        input.paidMinor,
        input.feeMinor,
        input.refundMinor,
        input.cancelledBy,
      ],
    );
    return id;
  }

  /**
   * Platform-wide booking numbers ACROSS EVERY TENANT — the super-admin
   * analytics dashboard. Same bypassRls reasoning as statsForTenant, just
   * with no tenant_id filter at all.
   */
  async platformStats(): Promise<{
    totalBookings: number;
    todayBookings: number;
    totalCancelled: number;
    todayCancelled: number;
    totalRevenueMinor: number;
    trend: { date: string; bookings: number; revenueMinor: number }[];
  }> {
    return this.uow.run({ name: 'booking.platformStats', bypassRls: true }, async (scope) => {
      const totals = await scope.client.query<{
        total_bookings: string;
        today_bookings: string;
        total_cancelled: string;
        today_cancelled: string;
        total_revenue_minor: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS total_bookings,
           count(*) FILTER (WHERE confirmed_at IS NOT NULL AND confirmed_at::date = current_date) AS today_bookings,
           count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS total_cancelled,
           count(*) FILTER (WHERE cancelled_at IS NOT NULL AND cancelled_at::date = current_date) AS today_cancelled,
           coalesce(sum(paid_minor) FILTER (WHERE status IN ('confirmed','completed')), 0) AS total_revenue_minor
         FROM bookings`,
      );
      const trendRows = await scope.client.query<{
        d: string;
        bookings: string;
        revenue_minor: string;
      }>(
        `SELECT confirmed_at::date::text AS d, count(*) AS bookings, coalesce(sum(paid_minor), 0) AS revenue_minor
           FROM bookings
          WHERE confirmed_at IS NOT NULL AND confirmed_at >= current_date - interval '13 days'
          GROUP BY 1 ORDER BY 1`,
      );
      const r = totals.rows[0];
      return {
        totalBookings: Number(r?.total_bookings ?? 0),
        todayBookings: Number(r?.today_bookings ?? 0),
        totalCancelled: Number(r?.total_cancelled ?? 0),
        todayCancelled: Number(r?.today_cancelled ?? 0),
        totalRevenueMinor: Number(r?.total_revenue_minor ?? 0),
        trend: trendRows.rows.map((row) => ({
          date: row.d,
          bookings: Number(row.bookings),
          revenueMinor: Number(row.revenue_minor),
        })),
      };
    });
  }

  /**
   * Per-operator numbers over a period (#106) — bookings confirmed, revenue
   * collected on them, cancellations and seats — for the platform ranking.
   * Operators with no booking in the period are left out.
   */
  async performanceByOperator(
    from: string,
    to: string,
  ): Promise<
    {
      tenantId: string;
      bookings: number;
      revenueMinor: number;
      cancelled: number;
      seats: number;
    }[]
  > {
    return this.uow.run(
      { name: 'booking.performanceByOperator', bypassRls: true },
      async (scope) => {
        const { rows } = await scope.client.query<{
          tenant_id: string;
          bookings: string;
          revenue_minor: string;
          cancelled: string;
          seats: string;
        }>(
          `SELECT b.tenant_id,
                count(*) FILTER (WHERE b.confirmed_at IS NOT NULL) AS bookings,
                coalesce(sum(b.paid_minor) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue_minor,
                count(*) FILTER (WHERE b.cancelled_at IS NOT NULL) AS cancelled,
                coalesce(sum(s.n) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS seats
           FROM bookings b
           LEFT JOIN LATERAL (SELECT count(*) AS n FROM booking_seats bs WHERE bs.booking_id = b.id) s ON true
          WHERE b.created_at >= $1::date AND b.created_at < $2::date + 1
          GROUP BY b.tenant_id`,
          [from, to],
        );
        return rows.map((r) => ({
          tenantId: r.tenant_id,
          bookings: Number(r.bookings),
          revenueMinor: Number(r.revenue_minor),
          cancelled: Number(r.cancelled),
          seats: Number(r.seats),
        }));
      },
    );
  }

  /**
   * What the per-service sales rules need to know about a trip, read inside
   * the hold's transaction after its seats are locked (#170, #173, #174). The
   * trip row is locked first so two holds cannot both take the last quota /
   * OTA seat.
   */
  async tripSalesState(
    tripId: TripId,
    segmentMask: bigint,
  ): Promise<{
    capacity: number;
    freeSeats: number;
    seatsByChannel: Record<string, number>;
    femaleSeats: number;
    seniorSeats: number;
  }> {
    await this.db.query(`SELECT 1 FROM trips WHERE id = $1 FOR UPDATE`, [tripId], {
      name: 'booking.salesState.lockTrip',
      primary: true,
    });
    const live = `(b.status IN ('confirmed', 'completed') OR (b.status = 'held' AND b.hold_expires_at > now()))`;
    const [seats] = await this.db.query<{ capacity: string; free: string }>(
      `SELECT count(*) AS capacity,
              count(*) FILTER (WHERE ((ts.occupied_legs | ts.blocked_legs) & $2) = 0
                AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                                 WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                                   AND b.status = 'held' AND b.hold_expires_at > now() AND (bs.leg_mask & $2) <> 0)) AS free
         FROM trip_seats ts WHERE ts.trip_id = $1 AND ts.is_bookable`,
      [tripId, segmentMask.toString()],
      { name: 'booking.salesState.seats', primary: true },
    );
    const channels = await this.db.query<{ channel: string; n: string }>(
      `SELECT b.channel, count(*) AS n FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.trip_id = $1 AND ${live} GROUP BY b.channel`,
      [tripId],
      { name: 'booking.salesState.channels', primary: true },
    );
    const [people] = await this.db.query<{ female: string; senior: string }>(
      `SELECT count(*) FILTER (WHERE lower(p.gender) = 'female') AS female,
              count(*) FILTER (WHERE p.category = 'senior') AS senior
         FROM passengers p JOIN bookings b ON b.id = p.booking_id
        WHERE b.trip_id = $1 AND ${live}`,
      [tripId],
      { name: 'booking.salesState.passengers', primary: true },
    );
    return {
      capacity: Number(seats?.capacity ?? 0),
      freeSeats: Number(seats?.free ?? 0),
      seatsByChannel: Object.fromEntries(channels.map((c) => [c.channel, Number(c.n)])),
      femaleSeats: Number(people?.female ?? 0),
      seniorSeats: Number(people?.senior ?? 0),
    };
  }

  /** Every still-live booking on a trip — for cascading cancellation when the OPERATOR cancels the whole trip (bus breakdown, etc.), never for a customer cancelling their own single seat. */
  async listActiveByTrip(tripId: TripId): Promise<{ id: BookingId; pnr: string }[]> {
    return this.db.query(
      `SELECT id, pnr FROM bookings WHERE tenant_id = $1 AND trip_id = $2 AND status IN ('held', 'confirmed')`,
      [requireTenantId(), tripId],
      { name: 'booking.listActiveByTrip' },
    );
  }

  /* ── amendments: the booking-owned rows an amendment rewrites (run in its unit of work) ── */

  /**
   * Reschedule: point the booking at another trip/segment and replace its
   * seats. What was paid for the ticket becomes the new total — a cheaper
   * trip's difference is refunded and a dearer one's collected separately
   * (the reschedule fee is income, not ticket value), so a later cancellation
   * refunds from the right amount.
   */
  async moveToTrip(input: {
    bookingId: BookingId;
    tripId: TripId;
    fromSeq: number;
    toSeq: number;
    fromStopId: StopId;
    toStopId: StopId;
    totalMinor: number;
    seats: { seatNumber: string; legMask: bigint; fareMinor: number }[];
    /** Each passenger's old seat → new seat; `codes[i]` is the boarding code for `moves[i].to`. */
    moves: { from: string; to: string }[];
    codes: string[];
  }): Promise<void> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `UPDATE bookings SET trip_id = $3, from_seq = $4, to_seq = $5, from_stop_id = $6, to_stop_id = $7,
              total_minor = $8, paid_minor = $8, times_rescheduled = times_rescheduled + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        input.bookingId,
        input.tripId,
        input.fromSeq,
        input.toSeq,
        input.fromStopId,
        input.toStopId,
        input.totalMinor,
      ],
      { name: 'booking.moveToTrip', primary: true },
    );
    await this.db.execute_(`DELETE FROM booking_seats WHERE booking_id = $1`, [input.bookingId], {
      name: 'booking.moveToTrip.clearSeats',
      primary: true,
    });
    await this.db.execute_(
      `INSERT INTO booking_seats (booking_id, tenant_id, trip_id, seat_number, leg_mask, fare_minor)
       SELECT $1, $2, $3, u.seat_number, u.leg_mask, u.fare_minor
         FROM unnest($4::text[], $5::bigint[], $6::bigint[]) AS u(seat_number, leg_mask, fare_minor)`,
      [
        input.bookingId,
        tenantId,
        input.tripId,
        input.seats.map((s) => s.seatNumber),
        input.seats.map((s) => s.legMask.toString()),
        input.seats.map((s) => s.fareMinor),
      ],
      { name: 'booking.moveToTrip.seats', primary: true },
    );
    // Passengers and tickets follow to the new bus and seats — the chart, the
    // manifest and boarding scans read them (they used to stay on the old ones).
    const from = input.moves.map((m) => m.from);
    const to = input.moves.map((m) => m.to);
    await this.db.execute_(
      `UPDATE passengers p SET seat_number = u.to_seat
         FROM unnest($2::text[], $3::text[]) AS u(from_seat, to_seat)
        WHERE p.booking_id = $1 AND p.seat_number = u.from_seat`,
      [input.bookingId, from, to],
      { name: 'booking.moveToTrip.passengers', primary: true },
    );
    await this.db.execute_(
      `UPDATE tickets SET boarding_code = boarding_code || ':' || id WHERE booking_id = $1`,
      [input.bookingId],
      { name: 'booking.moveToTrip.ticketsPark', primary: true },
    );
    await this.db.execute_(
      `UPDATE tickets t SET trip_id = $2, seat_number = u.to_seat, boarding_code = u.code
         FROM unnest($3::text[], $4::text[], $5::text[]) AS u(from_seat, to_seat, code)
        WHERE t.booking_id = $1 AND t.seat_number = u.from_seat`,
      [input.bookingId, input.tripId, from, to, input.codes],
      { name: 'booking.moveToTrip.tickets', primary: true },
    );
  }

  /**
   * Seat change on the same trip: move booking_seats, passengers and tickets
   * from each `from` seat to the matching `to` seat. `codes[i]` is the new
   * boarding code for `to[i]`.
   */
  async moveSeats(input: {
    bookingId: BookingId;
    tripId: TripId;
    from: string[];
    to: string[];
    legMasks: string[];
    fares: number[];
    codes: string[];
  }): Promise<void> {
    const { bookingId, from, to } = input;
    await this.db.execute_(
      `DELETE FROM booking_seats WHERE booking_id = $1 AND seat_number = ANY($2::text[])`,
      [bookingId, from],
      { name: 'booking.moveSeats.release', primary: true },
    );
    await this.db.execute_(
      `INSERT INTO booking_seats (booking_id, tenant_id, trip_id, seat_number, leg_mask, fare_minor)
       SELECT $1, $2, $3, u.seat_number, u.leg_mask, u.fare_minor
         FROM unnest($4::text[], $5::bigint[], $6::bigint[]) AS u(seat_number, leg_mask, fare_minor)`,
      [bookingId, requireTenantId(), input.tripId, to, input.legMasks, input.fares],
      { name: 'booking.moveSeats.seats', primary: true },
    );
    await this.db.execute_(
      `UPDATE passengers p SET seat_number = u.to_seat
         FROM unnest($2::text[], $3::text[]) AS u(from_seat, to_seat)
        WHERE p.booking_id = $1 AND p.seat_number = u.from_seat`,
      [bookingId, from, to],
      { name: 'booking.moveSeats.passengers', primary: true },
    );
    // Boarding codes are unique and derived from the seat, so move them in two
    // steps — a swap (1A↔1B) can never collide mid-statement.
    await this.db.execute_(
      `UPDATE tickets SET boarding_code = boarding_code || ':' || id
        WHERE booking_id = $1 AND seat_number = ANY($2::text[])`,
      [bookingId, from],
      { name: 'booking.moveSeats.ticketsPark', primary: true },
    );
    await this.db.execute_(
      `UPDATE tickets t SET seat_number = u.to_seat, boarding_code = u.code
         FROM unnest($2::text[], $3::text[], $4::text[]) AS u(from_seat, to_seat, code)
        WHERE t.booking_id = $1 AND t.seat_number = u.from_seat`,
      [bookingId, from, to, input.codes],
      { name: 'booking.moveSeats.tickets', primary: true },
    );
  }

  /** Point change: new boarding/dropping on the same trip, with each seat's new leg mask. */
  async changeSegment(input: {
    bookingId: BookingId;
    fromSeq: number;
    toSeq: number;
    fromStopId: string;
    toStopId: string;
    seats: { seatNumber: string; legMask: bigint }[];
  }): Promise<void> {
    await this.db.execute_(
      `UPDATE bookings SET from_seq = $3, to_seq = $4, from_stop_id = $5, to_stop_id = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        input.bookingId,
        input.fromSeq,
        input.toSeq,
        input.fromStopId,
        input.toStopId,
      ],
      { name: 'booking.changeSegment', primary: true },
    );
    await this.db.execute_(
      `UPDATE booking_seats bs SET leg_mask = u.mask
         FROM unnest($2::text[], $3::bigint[]) AS u(seat, mask)
        WHERE bs.booking_id = $1 AND bs.seat_number = u.seat`,
      [
        input.bookingId,
        input.seats.map((s) => s.seatNumber),
        input.seats.map((s) => s.legMask.toString()),
      ],
      { name: 'booking.changeSegment.seats', primary: true },
    );
  }

  async renamePassenger(bookingId: BookingId, seatNumber: string, fullName: string): Promise<void> {
    await this.db.execute_(
      `UPDATE passengers SET full_name = $3 WHERE booking_id = $1 AND seat_number = $2`,
      [bookingId, seatNumber, fullName],
      { name: 'booking.renamePassenger', primary: true },
    );
  }
}
