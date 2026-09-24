import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  SegmentQuerySchema,
  UuidParam,
  zodBody,
  zodQuery,
  type SegmentQuery,
} from '@http';

import { GdsService, type PartnerCtx } from '../application/gds.service';
import { GdsPartnerGuard } from './gds-partner.guard';
import {
  GdsBlockSchema,
  GdsCancelSchema,
  GdsSearchSchema,
  type GdsBlockDto,
  type GdsCancelDto,
  type GdsSearchDto,
} from './dto/gds.dto';

type PartnerReq = { gds: PartnerCtx };

/**
 * PUBLIC GDS PARTNER API — the single integration an OTA (redBus, AbhiBus,
 * Paytm, …) or a multi-operator agent builds to sell EVERY participating
 * operator. Auth: `X-GDS-Key`. Writes are idempotent (Idempotency-Key header).
 */
@ApiTags('gds-partner-api')
@ApiHeader({
  name: 'X-GDS-Key',
  required: true,
  description: 'Partner API key (gds_live_… or gds_test_…)',
})
@Controller({ path: 'gds', version: '1' })
@ApiStandardErrors()
@Public()
@UseGuards(GdsPartnerGuard)
export class GdsPartnerController {
  constructor(private readonly gds: GdsService) {}

  @Get('account')
  @ApiOperation({ summary: 'Your balance, credit limit, spendable amount and recent ledger' })
  account(@Req() req: PartnerReq) {
    return this.gds.account(req.gds);
  }

  @Post('search')
  @HttpCode(200)
  @RateLimit(600, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Search trips across all operators distributing to you (with your commission % per operator)',
  })
  search(@Req() req: PartnerReq, @Body(zodBody(GdsSearchSchema)) dto: GdsSearchDto) {
    return this.gds.searchTrips(req.gds, dto);
  }

  @Get('trips/:tripId/seats')
  @RateLimit(600, 60_000, 'ip')
  @ApiOperation({ summary: 'Live seat map for a segment' })
  seats(
    @Req() req: PartnerReq,
    @UuidParam('tripId') tripId: string,
    @Query(zodQuery(SegmentQuerySchema)) q: SegmentQuery,
  ) {
    return this.gds.seats(req.gds, tripId, q.from, q.to);
  }

  @Post('bookings')
  @HttpCode(201)
  @Idempotent()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: 'Block seats (tentative). Confirm before holdExpiresAt.' })
  block(@Req() req: PartnerReq, @Body(zodBody(GdsBlockSchema)) dto: GdsBlockDto) {
    return this.gds.block(req.gds, dto);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @Idempotent()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Confirm: debits your GDS account (ticket value minus your commission) and issues tickets. 402 if balance/credit is short.',
  })
  confirm(@Req() req: PartnerReq, @UuidParam('id') id: string) {
    return this.gds.confirm(req.gds, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary:
      "Cancel all or some seats of your booking (operator's cancellation policy); refund credited to your account",
  })
  cancel(
    @Req() req: PartnerReq,
    @UuidParam('id') id: string,
    @Body(zodBody(GdsCancelSchema)) dto: GdsCancelDto,
  ) {
    return this.gds.cancel(req.gds, id, dto);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Booking, passengers and tickets (your bookings only)' })
  booking(@Req() req: PartnerReq, @UuidParam('id') id: string) {
    return this.gds.bookingDetail(req.gds, id);
  }
}
