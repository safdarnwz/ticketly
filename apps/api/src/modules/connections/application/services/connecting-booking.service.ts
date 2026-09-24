import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, newId, runInNewContext, type TenantId } from '@kernel';

import { BookingService, BookingRepository } from '../../../booking';
import { PaymentService, type TestInstrument } from '../../../payment';
import { TicketService } from '../../../tickets';

export interface HoldConnectionInput {
  leg1: {
    tenantId: string;
    quoteId: string;
    seatNumbers: string[];
    passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[];
  };
  leg2: {
    tenantId: string;
    quoteId: string;
    seatNumbers: string[];
    passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[];
  };
  contactPhone: string;
  contactEmail?: string;
  customerId?: string;
}

/**
 * Books a two-leg connecting journey as TWO separate bookings (each leg is
 * a normal booking in its own tenant — a connection is a LINK on top, not
 * a new kind of booking), holding both before either is treated as
 * confirmed, and rolling back leg1's hold if leg2's fails. This is a
 * genuine two-phase operation across what may be two entirely separate
 * tenants — there is no single database transaction that could span both
 * (each tenant's booking lives under its own RLS-scoped connection), so
 * correctness here comes from the compensating-action pattern, not
 * atomicity: hold leg1, then TRY to hold leg2; on any failure, explicitly
 * release leg1 rather than leaving an orphaned hold sitting on someone's
 * seat map (it WOULD eventually expire on its own via the hold-sweep, but
 * that can be minutes away — the seat should free up immediately so
 * another passenger isn't blocked from it in the meantime).
 *
 * IMPORTANT, stated plainly rather than hidden: payment is charged as TWO
 * SEPARATE transactions (once per leg's own tenant), not a single unified
 * charge — there is no cross-tenant payment-splitting/settlement
 * mechanism in this codebase, and building one is a materially larger
 * fintech feature than the booking-linking itself. The customer sees two
 * line items (clearly labelled as one connecting journey) and two PNRs.
 */
@Injectable()
export class ConnectingBookingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bookings: BookingService,
    private readonly bookingRepo: BookingRepository,
    private readonly payments: PaymentService,
    private readonly tickets: TicketService,
  ) {}

  async holdConnection(input: HoldConnectionInput): Promise<{
    connectionId: string;
    leg1: { bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number };
    leg2: { bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number };
  }> {
    if (input.leg1.seatNumbers.length !== input.leg2.seatNumbers.length) {
      // Not a hard technical requirement, but a real product rule: a group
      // travelling together should book the SAME number of seats on both
      // legs — a booking with 3 seats on leg1 and 1 on leg2 is almost
      // certainly a mistake, not an intentional split journey.
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Both legs of a connecting journey must have the same number of seats',
      });
    }

    // Leg1: hold within ITS tenant's own bound context. BookingService is
    // ONE shared NestJS instance — every repository/query it uses reads
    // the ambient tenant via requireTenantId() internally, which is what
    // runInNewContext binds here; the same instance is reused for leg2
    // below under a DIFFERENT bound tenant.
    const leg1Hold = await runInNewContext(
      { tenantId: input.leg1.tenantId as TenantId, actorType: 'system' },
      () =>
        this.bookings.hold({
          quoteId: input.leg1.quoteId,
          seatNumbers: input.leg1.seatNumbers,
          passengers: input.leg1.passengers,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
        }),
    );

    // Leg2: hold within ITS OWN (possibly different) tenant's context. If
    // this fails for ANY reason — seats taken by someone else in the
    // meantime, the trip closed, whatever — leg1's hold must be released
    // rather than left to the passenger to notice; the customer should see
    // a clean "leg 2 unavailable" error, not a mystery held booking.
    let leg2Hold: { bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number };
    try {
      leg2Hold = await runInNewContext(
        { tenantId: input.leg2.tenantId as TenantId, actorType: 'system' },
        () =>
          this.bookings.hold({
            quoteId: input.leg2.quoteId,
            seatNumbers: input.leg2.seatNumbers,
            passengers: input.leg2.passengers,
            contactPhone: input.contactPhone,
            contactEmail: input.contactEmail,
          }),
      );
    } catch (err) {
      await runInNewContext(
        { tenantId: input.leg1.tenantId as TenantId, actorType: 'system' },
        () =>
          this.bookings
            .cancel(leg1Hold.bookingId as never, 'connecting-journey: leg 2 unavailable')
            .catch(() => undefined),
      );
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'The second leg of this connection is no longer available — please search again',
        cause: err as Error,
      });
    }

    // The link record itself is platform-level (no tenant context needed) —
    // written via a bypassRls scope, the same pattern as any other
    // cross-tenant table (see migration 0040's own comment).
    const connectionId = newId();
    await this.uow.run({ name: 'connections.create', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `INSERT INTO journey_connections (id, customer_id, leg1_tenant_id, leg1_booking_id, leg2_tenant_id, leg2_booking_id, connection_city_id, layover_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,
                 (SELECT dest_city_id FROM routes WHERE id = (SELECT route_id FROM bookings WHERE tenant_id = $3 AND id = $4)),
                 $7)`,
        [
          connectionId,
          input.customerId ?? null,
          input.leg1.tenantId,
          leg1Hold.bookingId,
          input.leg2.tenantId,
          leg2Hold.bookingId,
          Math.round(
            (new Date(leg2Hold.holdExpiresAt).getTime() -
              new Date(leg1Hold.holdExpiresAt).getTime()) /
              60_000,
          ),
        ],
      );
    });

    return { connectionId, leg1: leg1Hold, leg2: leg2Hold };
  }

  /**
   * Cancelling a connection cancels BOTH legs and marks the link
   * accordingly — a connecting journey is booked as one decision by the
   * customer, so a plain "cancel my trip" should undo both halves rather
   * than leaving leg2 dangling with no way to reach it (the passenger
   * would have arranged NO transport out of the connection city). Each
   * leg's OWN operator's cancellation/refund policy still applies to that
   * leg independently — cancelling does not force one operator's refund
   * percentage onto the other's booking.
   */
  async cancelConnection(
    connectionId: string,
  ): Promise<{ leg1RefundMinor: number; leg2RefundMinor: number }> {
    const link = await this.loadLink(connectionId);

    let leg1Refund = { refundMinor: 0, refundPct: 0 };
    let leg2Refund = { refundMinor: 0, refundPct: 0 };
    let leg1Failed = false;
    let leg2Failed = false;

    try {
      leg1Refund = await runInNewContext(
        { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
        () =>
          this.bookings.cancel(
            link.leg1_booking_id as never,
            'connecting-journey cancelled by customer',
          ),
      );
    } catch {
      leg1Failed = true;
    }

    try {
      leg2Refund = await runInNewContext(
        { tenantId: link.leg2_tenant_id as TenantId, actorType: 'system' },
        () =>
          this.bookings.cancel(
            link.leg2_booking_id as never,
            'connecting-journey cancelled by customer',
          ),
      );
    } catch {
      leg2Failed = true;
    }

    // Best-effort status: reflects what ACTUALLY got cancelled, not what
    // was requested — if leg1 was already cancelled/departed and only
    // leg2 succeeds here, the link should say so accurately rather than
    // claiming a clean "both_cancelled" that didn't really happen.
    const status =
      leg1Failed && leg2Failed
        ? 'active'
        : leg1Failed
          ? 'leg2_cancelled'
          : leg2Failed
            ? 'leg1_cancelled'
            : 'both_cancelled';
    await this.uow.run({ name: 'connections.updateStatus', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE journey_connections SET status = $2, updated_at = now() WHERE id = $1`,
        [connectionId, status],
      );
    });

    return { leg1RefundMinor: leg1Refund.refundMinor, leg2RefundMinor: leg2Refund.refundMinor };
  }

  private async loadLink(connectionId: string): Promise<{
    leg1_tenant_id: string;
    leg1_booking_id: string;
    leg2_tenant_id: string;
    leg2_booking_id: string;
    status: string;
  }> {
    const link = await this.uow.run(
      { name: 'connections.load', bypassRls: true },
      async (scope) => {
        const row = await scope.client.query<{
          leg1_tenant_id: string;
          leg1_booking_id: string;
          leg2_tenant_id: string;
          leg2_booking_id: string;
          status: string;
        }>(
          `SELECT leg1_tenant_id, leg1_booking_id, leg2_tenant_id, leg2_booking_id, status FROM journey_connections WHERE id = $1`,
          [connectionId],
        );
        return row.rows[0] ?? null;
      },
    );
    if (!link)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Connection not found' });
    return link;
  }

  /**
   * Pays for BOTH legs. Every edge case below is deliberate, not an
   * oversight — a connecting journey spans two independent payment
   * systems (one per tenant), so "confirm" cannot be a single atomic step
   * the way a normal booking's payment is:
   *
   *  - leg1's charge fails -> throw immediately, leg2 is left UNTOUCHED
   *    (still held). The customer can retry, or cancel the whole
   *    connection — nothing has been charged yet on either side.
   *  - leg1 succeeds, then leg2's charge fails -> leg1 is NOT rolled back.
   *    A successfully-captured payment is real money that moved; silently
   *    reversing it because a SEPARATE operator's charge failed would be
   *    more surprising to the customer than the alternative — they keep a
   *    confirmed, ticketed leg1 and get a clear "leg 2 payment failed,
   *    retry it" result they can act on immediately (their leg2 hold
   *    generally still has a few minutes left).
   *  - leg2's hold happens to have EXPIRED by the time its charge is
   *    attempted (leg1's payment took a while) -> surfaced as its own
   *    distinct failure reason, not a generic "payment failed", since the
   *    fix is different (re-search leg2, not just retry the same charge).
   *  - the connection was already fully confirmed (a retried/duplicate
   *    confirm call) -> short-circuits to returning the existing tickets
   *    rather than attempting to charge an already-paid booking again.
   */
  async confirmConnection(
    connectionId: string,
    leg1Instrument: TestInstrument,
    leg2Instrument: TestInstrument,
  ): Promise<{
    leg1: { status: string; pnr?: string; ticketHtmlUrl?: string };
    leg2: { status: string; pnr?: string; ticketHtmlUrl?: string; error?: string };
  }> {
    const link = await this.loadLink(connectionId);

    const leg1Booking = await runInNewContext(
      { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
      () => this.bookingRepo.findForUpdate(link.leg1_booking_id as never),
    );
    if (!leg1Booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Leg 1 booking not found' });

    if (leg1Booking.status === 'held') {
      await runInNewContext(
        { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
        () => this.payments.chargeTest(link.leg1_booking_id as never, leg1Instrument),
      );
      // leg1 succeeding is the ONLY thing that must happen before leg2 is
      // even attempted — a connecting journey where leg1 couldn't be paid
      // for has no reason to charge leg2 at all.
    } else if (leg1Booking.status !== 'confirmed') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: `Leg 1 is ${leg1Booking.status} and cannot be paid for`,
      });
    }

    const leg2Booking = await runInNewContext(
      { tenantId: link.leg2_tenant_id as TenantId, actorType: 'system' },
      () => this.bookingRepo.findForUpdate(link.leg2_booking_id as never),
    );
    if (!leg2Booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Leg 2 booking not found' });

    let leg2Result: { status: string; pnr?: string; ticketHtmlUrl?: string; error?: string };
    if (leg2Booking.status === 'confirmed') {
      leg2Result = { status: 'confirmed', pnr: leg2Booking.pnr };
    } else if (leg2Booking.status !== 'held') {
      leg2Result = {
        status: leg2Booking.status,
        error: `Leg 2 is ${leg2Booking.status} — it can no longer be paid for. Leg 1 remains confirmed; contact support about leg 2.`,
      };
    } else {
      try {
        await runInNewContext(
          { tenantId: link.leg2_tenant_id as TenantId, actorType: 'system' },
          () => this.payments.chargeTest(link.leg2_booking_id as never, leg2Instrument),
        );
        leg2Result = { status: 'confirmed', pnr: leg2Booking.pnr };
      } catch (err) {
        leg2Result = {
          status: 'payment_failed',
          error:
            (err as Error).message ??
            'Leg 2 payment failed. Leg 1 is confirmed — you can retry leg 2 separately.',
        };
      }
    }

    await this.uow.run({ name: 'connections.markConfirmed', bypassRls: true }, async (scope) => {
      await scope.client.query(`UPDATE journey_connections SET updated_at = now() WHERE id = $1`, [
        connectionId,
      ]);
    });

    const leg1Ticket = await runInNewContext(
      { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
      () => this.tickets.issueForBooking(link.leg1_booking_id as never).catch(() => null),
    );

    return {
      leg1: { status: 'confirmed', pnr: leg1Ticket?.pnr },
      leg2: leg2Result,
    };
  }

  /** Both legs' confirmed status + PNRs — the "here are your two tickets" view once payment for both has gone through. */
  async getConnectionDetails(connectionId: string): Promise<{
    connectionId: string;
    status: string;
    leg1: { bookingId: string; tenantId: string; status: string; pnr: string };
    leg2: { bookingId: string; tenantId: string; status: string; pnr: string };
  }> {
    const link = await this.loadLink(connectionId);

    const leg1 = await runInNewContext(
      { tenantId: link.leg1_tenant_id as TenantId, actorType: 'system' },
      () => this.bookingRepo.findForUpdate(link.leg1_booking_id as never),
    );
    const leg2 = await runInNewContext(
      { tenantId: link.leg2_tenant_id as TenantId, actorType: 'system' },
      () => this.bookingRepo.findForUpdate(link.leg2_booking_id as never),
    );
    if (!leg1 || !leg2)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'One or both legs of this connection could not be found',
      });

    return {
      connectionId,
      status: link.status,
      leg1: {
        bookingId: link.leg1_booking_id,
        tenantId: link.leg1_tenant_id,
        status: leg1.status,
        pnr: leg1.pnr,
      },
      leg2: {
        bookingId: link.leg2_booking_id,
        tenantId: link.leg2_tenant_id,
        status: leg2.status,
        pnr: leg2.pnr,
      },
    };
  }
}
