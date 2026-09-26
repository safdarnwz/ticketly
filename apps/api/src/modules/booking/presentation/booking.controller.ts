import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import {
  BadRequestError,
  DEFAULT_TIMEZONE,
  ForbiddenError,
  getContext,
  hasPermission,
  daysBetween,
  decodeCursor,
  encodeCursor,
  getUserId,
  isUuid,
  isValidTimeZone,
  localDate,
  todayIn,
  NotFoundError,
  runAsTenant,
  UnauthenticatedError,
  type BookingId,
  type TenantId,
  type TripId,
} from '@kernel';

import { NotificationService } from '../../notification';
import { BookingRepository } from '../infrastructure/persistence/booking.repository';
import { allowedSalesChannel } from '../application/services/sales-channel';
import { BookingService } from '../application/services/booking.service';
import { TripOpsService } from '../application/services/trip-ops.service';
import { TripChartService } from '../application/services/trip-chart.service';
import {
  CancelSchema,
  CancelSeatsSchema,
  CancelTripSchema,
  ConfirmSchema,
  ContactMobileQuerySchema,
  ExtendHoldSchema,
  HoldSchema,
  PhoneBookingSchema,
  SelfCancelSchema,
  StaffBookingSearchQuerySchema,
  type CancelDto,
  type CancelSeatsDto,
  type CancelTripDto,
  type ConfirmDto,
  type ContactMobileQueryDto,
  type ExtendHoldDto,
  type HoldDto,
  type PhoneBookingDto,
  type SelfCancelDto,
  type StaffBookingSearchQueryDto,
  ReleaseHoldSchema,
  type ReleaseHoldDto,
} from './dto/booking.dto';

/**
 * Booking endpoints. The mutating ones are `@Idempotent()` — a retried "hold"
 * or "confirm" on a flaky connection must never create two bookings or charge
 * twice (the architecture test in Part 10 enforces this on every money/inventory
 * route).
 */
@ApiTags('booking')
@ApiBearerAuth('bearer')
@Controller({ path: 'bookings', version: '1' })
@ApiStandardErrors()
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly bookings: BookingRepository,
    private readonly tripOps: TripOpsService,
    private readonly notifications: NotificationService,
    private readonly tripChart: TripChartService,
  ) {}

  @Post('hold')
  @HttpCode(201)
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({ summary: 'Hold seats against a price quote (guest checkout)' })
  async hold(@Body(zodBody(HoldSchema)) dto: HoldDto) {
    return this.booking.hold({ ...dto, channel: allowedSalesChannel(dto.channel) });
  }

  /**
   * PHONE BOOKING (staff): keep seats for a caller who pays later — by the
   * payment link or at a branch (then staff confirm via :id/confirm). The
   * seats are released automatically at `releaseAt` if unpaid.
   */
  @Post('phone')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({
    summary: 'Phone booking: hold seats until a release time; pay later (link or branch)',
  })
  async phoneBooking(@Body(zodBody(PhoneBookingSchema)) dto: PhoneBookingDto) {
    const { releaseAt, ...hold } = dto;
    return this.booking.hold({ ...hold, channel: 'phone' }, { holdUntil: new Date(releaseAt) });
  }

  @Post(':id/extend-hold')
  @Idempotent()
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Phone booking: change the release time while it is still on hold' })
  async extendHold(
    @UuidParam('id') id: string,
    @Body(zodBody(ExtendHoldSchema)) dto: ExtendHoldDto,
  ) {
    return this.booking.extendPhoneHold(id as BookingId, new Date(dto.releaseAt));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({
    summary: 'Manually confirm a booking as paid (staff-assisted / cash / counter payment ONLY)',
  })
  async confirm(@UuidParam('id') id: string, @Body(zodBody(ConfirmSchema)) dto: ConfirmDto) {
    // NOT public, and never was safe to be: this trusts the CALLER's own
    // `paidMinor` figure with no gateway verification at all — fine for a
    // staff member who has actually taken cash/counter payment, catastrophic
    // for an anonymous client (free tickets for anyone who calls it with the
    // booking total). The real online-payment path never reaches here — see
    // PaymentService.verifyAndCapture (client-side signature check) and
    // PaymentService.handleWebhook (server-to-server, signature-verified),
    // both of which confirm the booking internally, already gateway-verified.
    return this.booking.confirm(id as BookingId, {
      paidMinor: dto.paidMinor,
      reference: dto.paymentReference,
    });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({ summary: 'Cancel a booking and compute the refund' })
  async cancel(@UuidParam('id') id: string, @Body(zodBody(CancelSchema)) dto: CancelDto) {
    return this.booking.cancel(
      id as BookingId,
      dto.reason,
      false,
      dto.refundDestination,
      dto.altAccountDetails,
    );
  }

  @Post(':id/cancel-seats')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({
    summary:
      'Cancel only SOME seats of a multi-seat booking — the rest stay confirmed; each seat refunds off its own fare. Operator staff (booking:cancel), the signed-in customer who booked it, or the booking mobile as proof; only staff may send the refund to another account.',
  })
  async cancelSeats(
    @UuidParam('id') id: string,
    @Body(zodBody(CancelSeatsSchema)) dto: CancelSeatsDto,
  ) {
    const run = (asStaff = false) =>
      this.booking.cancelSeats(
        id as BookingId,
        dto.seatNumbers,
        dto.reason,
        dto.refundDestination,
        dto.altAccountDetails,
        asStaff,
      );
    // Operator staff: the booking must be theirs (the service reads it in
    // the caller's tenant, so another operator's id is simply not found).
    if (getContext()?.tenantId && hasPermission(Permission.BOOKING_CANCEL)) return run(true);

    // Anyone else proves the booking is theirs — it used to take any id.
    const info = await this.bookings.accessInfo(id);
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-10);
    const owner = Boolean(info?.customerId) && info?.customerId === getUserId();
    const byPhone =
      Boolean(dto.mobile) &&
      digits(dto.mobile).length === 10 &&
      digits(dto.mobile) === digits(info?.contactPhone);
    if (!info || (!owner && !byPhone)) throw new NotFoundError('Booking', id);
    if (dto.refundDestination !== 'source')
      throw new ForbiddenError({
        message: 'The refund goes back to how you paid — ask the operator to send it elsewhere',
      });
    return runAsTenant(info.tenantId as TenantId, () => run());
  }

  @Get('search')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary:
      "This operator's bookings, newest first: by PNR / mobile / ticket number (any date), or a period (default today, max 92 days) by booking or journey date, with status, channel and trip filters; cursor paging",
  })
  async search(@Query(zodQuery(StaffBookingSearchQuerySchema)) q: StaffBookingSearchQueryDto) {
    const byId = Boolean(q.pnr || q.mobile || q.ticket);
    let from = q.from;
    let to = q.to;
    if (!byId && !from && !to) {
      const tz = await this.bookings.operatorTimezone();
      from = to = todayIn(isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);
    }
    if (from && to && daysBetween(localDate(from), localDate(to)) + 1 > 92)
      throw new BadRequestError('Choose at most 92 days');
    let before: { createdAt: string; id: string } | undefined;
    if (q.cursor) {
      let c: ReturnType<typeof decodeCursor>;
      try {
        c = decodeCursor(q.cursor);
      } catch {
        c = undefined;
      }
      const [at, id] = c?.k ?? [];
      if (c?.v !== 1 || typeof at !== 'string' || Number.isNaN(Date.parse(at)) || !isUuid(id))
        throw new BadRequestError('That page link is no longer valid — start from the first page');
      before = { createdAt: at, id: id };
    }
    const rows = await this.bookings.search({ ...q, from, to, before, limit: q.limit + 1 });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    return {
      from: from ?? null,
      to: to ?? null,
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ v: 1, k: [new Date(last.createdAt).toISOString(), last.id], d: 'desc' })
          : null,
    };
  }

  @Get('by-pnr/:pnr')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Look up a booking by PNR + the contact mobile it was booked with (customer self-service)',
  })
  async byPnr(
    @Param('pnr') pnr: string,
    @Query(zodQuery(ContactMobileQuerySchema)) { mobile }: ContactMobileQueryDto,
  ) {
    // No tenant is bound on www.ticketly.com, and PNR is only unique PER
    // OPERATOR — `mobile` is REQUIRED, both to disambiguate and to prove the
    // caller actually owns this booking (see BookingRepository.getByPnr).
    const booking = await this.bookings.getByPnr(pnr, mobile);
    const seats = await runAsTenant(booking.tenantId as TenantId, () =>
      this.bookings.loadSeats(booking.id),
    );
    return { booking, seats: seats.map((s) => s.seatNumber) };
  }

  @Get('by-pnr-staff/:pnr')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary:
      "Staff/ops lookup by PNR alone — no phone-match required, for internal tools (refund lookup etc.) where a staff member has the PNR but not necessarily the customer's phone number",
  })
  async byPnrStaff(@Param('pnr') pnr: string) {
    const booking = await this.bookings.findByPnrStaff(pnr);
    if (!booking) throw new NotFoundError('Booking', pnr);
    const [detail] = await this.bookings.search({ pnr: booking.pnr, limit: 1 });
    const passengers = await this.bookings.loadPassengers(booking.id);
    passengers.sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true }));
    const emails = (await this.notifications.documentStatus([booking.id])).get(booking.id) ?? {};
    return { booking, detail: detail ?? null, passengers, emails };
  }

  /**
   * The signed-in customer's own bookings across every operator. It used to
   * take any mobile number with no proof — anyone could list a stranger's
   * trips; a booking made without signing in is found with PNR + mobile.
   */
  @Get('mine')
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({ summary: "The signed-in customer's bookings, across every operator" })
  async mine() {
    const userId = getUserId();
    if (!userId) throw new UnauthenticatedError();
    return { bookings: await this.bookings.listForCustomer(userId) };
  }

  /** Free the seats of an unpaid hold now (customer changed their mind); idempotent. */
  @Post(':id/release-hold')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @ApiOperation({
    summary: 'Release an unpaid hold early — the booking customer, or the booking mobile as proof',
  })
  async releaseHold(
    @UuidParam('id') id: string,
    @Body(zodBody(ReleaseHoldSchema)) dto: ReleaseHoldDto,
  ) {
    const mobileDigits = dto.mobile?.replace(/\D/g, '').slice(-10);
    const customerId = getUserId();
    if (!customerId && (!mobileDigits || mobileDigits.length !== 10))
      throw new BadRequestError('Give the mobile number the booking was made with');
    const released = await this.bookings.releaseHold(id, {
      customerId: customerId ?? undefined,
      mobileDigits: mobileDigits?.length === 10 ? mobileDigits : undefined,
    });
    return { released };
  }

  @Get(':id/refund-preview')
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({
    summary:
      'What cancelling this booking would refund RIGHT NOW — no mobile-ownership check since nothing is mutated, just a computed preview',
  })
  async refundPreview(@UuidParam('id') id: string) {
    return this.booking.previewRefund(id as BookingId);
  }

  @Post(':id/self-cancel')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({
    summary: 'Customer self-service cancellation (mobile proves ownership, no login needed)',
  })
  async selfCancel(
    @UuidParam('id') id: string,
    @Body(zodBody(SelfCancelSchema)) dto: SelfCancelDto,
  ) {
    const owned = await this.bookings.verifyOwnership(id, dto.mobile);
    if (!owned) throw new BadRequestError('Booking not found for this mobile number');
    return runAsTenant(owned.tenantId as TenantId, () =>
      this.booking.cancel(id as BookingId, dto.reason),
    );
  }

  /* ── trip-level operations (staff) — the whole trip, not one booking ──── */

  @Get('trips/:tripId/chart')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary:
      'Reservation chart: the bus layout with every passenger (seat, name, PNR, boarding → dropping, phone), holds being paid now, blocked seats and totals',
  })
  async chart(@UuidParam('tripId') tripId: string) {
    return this.tripChart.chart(tripId as TripId);
  }

  @Post('trips/:tripId/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Cancel the whole trip — cascades to every live booking, each refunded exactly as a normal cancellation',
  })
  async cancelTrip(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(CancelTripSchema)) dto: CancelTripDto,
  ) {
    return this.tripOps.cancelTrip(tripId as never, dto.reason);
  }

  @Post('trips/:tripId/stop-sales')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Stop taking new bookings on this trip (existing bookings untouched)' })
  async stopSales(@UuidParam('tripId') tripId: string) {
    await this.tripOps.stopSales(tripId as never);
    return { ok: true };
  }

  @Post('trips/:tripId/resume-sales')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Resume selling a trip that had sales stopped' })
  async resumeSales(@UuidParam('tripId') tripId: string) {
    await this.tripOps.resumeSales(tripId as never);
    return { ok: true };
  }

  @Post('tickets/:ticketId/no-show')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary: 'Mark a passenger as a no-show (never boarded) — for reporting, not a refund decision',
  })
  async markNoShow(@UuidParam('ticketId') ticketId: string) {
    await this.tripOps.markNoShow(ticketId as never);
    return { ok: true };
  }
}
