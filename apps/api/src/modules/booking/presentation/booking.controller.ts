import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, Public, RateLimit, RequirePermission, zodBody } from '@http';
import { BadRequestError, NotFoundError, runAsTenant, type BookingId, type TenantId } from '@kernel';

import { BookingRepository } from '../infrastructure/persistence/booking.repository';
import { BookingService } from '../application/services/booking.service';
import { TripOpsService } from '../application/services/trip-ops.service';
import {
  CancelSchema, type CancelDto,
  CancelSeatsSchema, type CancelSeatsDto,
  ConfirmSchema, type ConfirmDto,
  HoldSchema, type HoldDto,
  PhoneBookingSchema, type PhoneBookingDto, ExtendHoldSchema, type ExtendHoldDto,
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
  ) {}

  @Post('hold')
  @HttpCode(201)
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({ summary: 'Hold seats against a price quote (guest checkout)' })
  async hold(@Body(zodBody(HoldSchema)) dto: HoldDto) {
    return this.booking.hold(dto);
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
  @ApiOperation({ summary: 'Phone booking: hold seats until a release time; pay later (link or branch)' })
  async phoneBooking(@Body(zodBody(PhoneBookingSchema)) dto: PhoneBookingDto) {
    const { releaseAt, ...hold } = dto;
    return this.booking.hold({ ...hold, channel: 'phone' }, { holdUntil: new Date(releaseAt) });
  }

  @Post(':id/extend-hold')
  @Idempotent()
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Phone booking: change the release time while it is still on hold' })
  async extendHold(@Param('id') id: string, @Body(zodBody(ExtendHoldSchema)) dto: ExtendHoldDto) {
    return this.booking.extendPhoneHold(id as BookingId, new Date(dto.releaseAt));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Manually confirm a booking as paid (staff-assisted / cash / counter payment ONLY)' })
  async confirm(@Param('id') id: string, @Body(zodBody(ConfirmSchema)) dto: ConfirmDto) {
    // NOT public, and never was safe to be: this trusts the CALLER's own
    // `paidMinor` figure with no gateway verification at all — fine for a
    // staff member who has actually taken cash/counter payment, catastrophic
    // for an anonymous client (free tickets for anyone who calls it with the
    // booking total). The real online-payment path never reaches here — see
    // PaymentService.verifyAndCapture (client-side signature check) and
    // PaymentService.handleWebhook (server-to-server, signature-verified),
    // both of which confirm the booking internally, already gateway-verified.
    return this.booking.confirm(id as BookingId, { paidMinor: dto.paidMinor, reference: dto.paymentReference });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({ summary: 'Cancel a booking and compute the refund' })
  async cancel(@Param('id') id: string, @Body(zodBody(CancelSchema)) dto: CancelDto) {
    return this.booking.cancel(id as BookingId, dto.reason, false, dto.refundDestination, dto.altAccountDetails);
  }

  @Post(':id/cancel-seats')
  @HttpCode(200)
  @Public()
  @Idempotent()
  @ApiOperation({ summary: 'Cancel only SOME seats of a multi-seat booking (e.g. one family member drops out) — the remaining seats stay confirmed. Each cancelled seat refunds off its own actual fare.' })
  async cancelSeats(@Param('id') id: string, @Body(zodBody(CancelSeatsSchema)) dto: CancelSeatsDto) {
    return this.booking.cancelSeats(id as BookingId, dto.seatNumbers, dto.reason, dto.refundDestination, dto.altAccountDetails);
  }

  @Get('search')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Staff search by PNR, mobile number (any format) or ticket number — at least one is required' })
  async search(@Query('pnr') pnr?: string, @Query('mobile') mobile?: string, @Query('ticket') ticket?: string) {
    if (!pnr && !mobile && !ticket) throw new BadRequestError('Give a PNR, mobile number or ticket number');
    if (mobile && mobile.replace(/\D/g, '').length < 10) throw new BadRequestError('Enter a 10-digit mobile number');
    return { items: await this.bookings.search({ pnr, mobile, ticket }) };
  }

  @Get('by-pnr/:pnr')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({ summary: 'Look up a booking by PNR + the contact mobile it was booked with (customer self-service)' })
  async byPnr(@Param('pnr') pnr: string, @Query('mobile') mobile: string) {
    // No tenant is bound on www.ticketly.com, and PNR is only unique PER
    // OPERATOR — `mobile` is REQUIRED, both to disambiguate and to prove the
    // caller actually owns this booking (see BookingRepository.getByPnr).
    if (!mobile?.trim()) throw new BadRequestError('mobile is required');
    const booking = await this.bookings.getByPnr(pnr, mobile);
    const seats = await runAsTenant(booking.tenantId as TenantId, () => this.bookings.loadSeats(booking.id));
    return { booking, seats: seats.map((s) => s.seatNumber) };
  }

  @Get('by-pnr-staff/:pnr')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Staff/ops lookup by PNR alone — no phone-match required, for internal tools (refund lookup etc.) where a staff member has the PNR but not necessarily the customer\'s phone number' })
  async byPnrStaff(@Param('pnr') pnr: string) {
    const booking = await this.bookings.findByPnrStaff(pnr);
    if (!booking) throw new NotFoundError('Booking', pnr);
    return { booking };
  }

  @Get('mine')
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({ summary: "All of a phone number's bookings, across every operator (mobile self-service)" })
  async mine(@Query('mobile') mobile: string) {
    if (!mobile?.trim()) throw new BadRequestError('mobile is required');
    const bookings = await this.bookings.listByContactPhone(mobile);
    return { bookings };
  }

  @Get(':id/refund-preview')
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({ summary: 'What cancelling this booking would refund RIGHT NOW — no mobile-ownership check since nothing is mutated, just a computed preview' })
  async refundPreview(@Param('id') id: string) {
    return this.booking.previewRefund(id as BookingId);
  }

  @Post(':id/self-cancel')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({ summary: 'Customer self-service cancellation (mobile proves ownership, no login needed)' })
  async selfCancel(@Param('id') id: string, @Body() dto: { mobile: string; reason?: string }) {
    if (!dto.mobile?.trim()) throw new BadRequestError('mobile is required');
    const owned = await this.bookings.verifyOwnership(id, dto.mobile);
    if (!owned) throw new BadRequestError('Booking not found for this mobile number');
    return runAsTenant(owned.tenantId as TenantId, () => this.booking.cancel(id as BookingId, dto.reason));
  }

  /* ── trip-level operations (staff) — the whole trip, not one booking ──── */

  @Post('trips/:tripId/cancel')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Cancel the whole trip — cascades to every live booking, each refunded exactly as a normal cancellation' })
  async cancelTrip(@Param('tripId') tripId: string, @Body() dto: { reason: string }) {
    return this.tripOps.cancelTrip(tripId as never, dto.reason);
  }

  @Post('trips/:tripId/stop-sales')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Stop taking new bookings on this trip (existing bookings untouched)' })
  async stopSales(@Param('tripId') tripId: string) {
    await this.tripOps.stopSales(tripId as never);
    return { ok: true };
  }

  @Post('trips/:tripId/resume-sales')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Resume selling a trip that had sales stopped' })
  async resumeSales(@Param('tripId') tripId: string) {
    await this.tripOps.resumeSales(tripId as never);
    return { ok: true };
  }

  @Post('tickets/:ticketId/no-show')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Mark a passenger as a no-show (never boarded) — for reporting, not a refund decision' })
  async markNoShow(@Param('ticketId') ticketId: string) {
    await this.tripOps.markNoShow(ticketId as never);
    return { ok: true };
  }
}
