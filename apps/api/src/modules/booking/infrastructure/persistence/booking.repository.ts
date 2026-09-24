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
  /** Only populated by cross-tenant reads (`listByContactPhone`) — not selected elsewhere. */
  tenantId?: string;
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
          fare_breakup, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'held',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
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
  async search(q: {
    pnr?: string;
    mobile?: string;
    ticket?: string;
    agentId?: string;
    from?: string;
    to?: string;
  }): Promise<unknown[]> {
    const digits = (q.mobile ?? '').replace(/\D/g, '').slice(-10);
    return this.db.query(
      `SELECT DISTINCT b.id, b.pnr, b.status, b.total_minor AS "totalMinor", b.contact_phone AS "contactPhone", b.channel, b.created_at AS "createdAt",
              t.journey_date AS "journeyDate", r.name AS "routeName"
         FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN routes r ON r.id = t.route_id
         LEFT JOIN tickets tk ON tk.booking_id = b.id
        WHERE b.tenant_id = $1
          AND ($2::text IS NULL OR upper(b.pnr) = upper($2))
          AND ($3::text IS NULL OR right(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g'), 10) = $3)
          AND ($4::text IS NULL OR upper(tk.boarding_code) = upper($4))
          AND ($5::uuid IS NULL OR b.agent_id = $5)
          AND ($6::date IS NULL OR b.created_at >= $6::date)
          AND ($7::date IS NULL OR b.created_at < $7::date + 1)
        ORDER BY b.created_at DESC LIMIT 50`,
      [
        requireTenantId(),
        q.pnr?.trim() || null,
        digits.length === 10 ? digits : null,
        q.ticket?.trim() || null,
        q.agentId ?? null,
        q.from ?? null,
        q.to ?? null,
      ],
      { name: 'booking.search' },
    );
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
  async findByPnrStaff(pnr: string): Promise<BookingRow | null> {
    return this.uow.run<BookingRow | null>(
      { name: 'booking.findByPnrStaff', bypassRls: true },
      async (scope) => {
        const result = await scope.client.query<BookingRow>(
          `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
                status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
                coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version, tenant_id AS "tenantId"
           FROM bookings WHERE pnr = $1
           LIMIT 1`,
          [pnr.trim().toUpperCase()],
        );
        return result.rows[0] ?? null;
      },
    );
  }

  /** All bookings for a phone number, across every operator — for "my bookings" / mobile self-service. Same bypassRls reasoning as `getByPnr`. */
  async listByContactPhone(contactPhone: string): Promise<BookingRow[]> {
    return this.uow.run<BookingRow[]>(
      { name: 'booking.listByContactPhone', bypassRls: true },
      async (scope) => {
        const result = await scope.client.query<BookingRow>(
          `SELECT id, pnr, trip_id AS "tripId", route_id AS "routeId", from_seq AS "fromSeq", to_seq AS "toSeq",
                status, seat_count AS "seatCount", customer_id AS "customerId", currency, total_minor AS "totalMinor", paid_minor AS "paidMinor",
                coupon_code AS "couponCode", hold_expires_at AS "holdExpiresAt", version, tenant_id AS "tenantId"
           FROM bookings WHERE contact_phone = $1
           ORDER BY created_at DESC LIMIT 100`,
          [contactPhone.trim()],
        );
        return result.rows;
      },
    );
  }

  /**
   * Proves a caller actually owns a booking (matching contact mobile) and
   * returns which tenant it belongs to — for the customer self-service
   * cancel/reschedule endpoints, which run from www.ticketly.com with no
   * tenant of their own (same bypassRls reasoning as getByPnr).
   */
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
  async statsForTenant(tenantId: string): Promise<{
    totalBookings: number;
    todayBookings: number;
    totalCancelled: number;
    todayCancelled: number;
    totalRevenueMinor: number;
  }> {
    return this.uow.run({ name: 'booking.statsForTenant', bypassRls: true }, async (scope) => {
      const row = await scope.client.query<{
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
         FROM bookings WHERE tenant_id = $1`,
        [tenantId],
      );
      const r = row.rows[0];
      return {
        totalBookings: Number(r?.total_bookings ?? 0),
        todayBookings: Number(r?.today_bookings ?? 0),
        totalCancelled: Number(r?.total_cancelled ?? 0),
        todayCancelled: Number(r?.today_cancelled ?? 0),
        totalRevenueMinor: Number(r?.total_revenue_minor ?? 0),
      };
    });
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
              b.pnr, b.from_stop_id AS "fromStopId", b.to_stop_id AS "toStopId",
              t.status AS "ticketStatus"
         FROM passengers p
         JOIN bookings b ON b.id = p.booking_id AND b.status = 'confirmed'
         LEFT JOIN tickets t ON t.booking_id = b.id AND t.seat_number = p.seat_number
        WHERE p.tenant_id = $1 AND b.trip_id = $2
        ORDER BY p.seat_number`,
      [requireTenantId(), tripId],
      { name: 'booking.manifest' },
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
    const row = await this.db.queryOne<{ status: string }>(
      `SELECT status FROM tickets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), ticketId],
      { name: 'booking.lockTicket', primary: true },
    );
    return row?.status ?? null;
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

  /** Every still-live booking on a trip — for cascading cancellation when the OPERATOR cancels the whole trip (bus breakdown, etc.), never for a customer cancelling their own single seat. */
  async listActiveByTrip(tripId: TripId): Promise<{ id: BookingId; pnr: string }[]> {
    return this.db.query(
      `SELECT id, pnr FROM bookings WHERE tenant_id = $1 AND trip_id = $2 AND status IN ('held', 'confirmed')`,
      [requireTenantId(), tripId],
      { name: 'booking.listActiveByTrip' },
    );
  }

  /* ── amendments: the booking-owned rows an amendment rewrites (run in its unit of work) ── */

  /** Reschedule: point the booking at another trip/segment and replace its seats. */
  async moveToTrip(input: {
    bookingId: BookingId;
    tripId: TripId;
    fromSeq: number;
    toSeq: number;
    fromStopId: StopId;
    toStopId: StopId;
    totalMinor: number;
    seats: { seatNumber: string; legMask: bigint; fareMinor: number }[];
  }): Promise<void> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `UPDATE bookings SET trip_id = $3, from_seq = $4, to_seq = $5, from_stop_id = $6, to_stop_id = $7,
              total_minor = $8, times_rescheduled = times_rescheduled + 1, updated_at = now()
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
