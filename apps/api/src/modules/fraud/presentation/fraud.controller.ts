import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, RequirePlatformAdmin, zodBody } from '@http';
import { type BookingId, type UserId } from '@kernel';

import { FraudService } from '../application/services/fraud.service';

const AssessSchema = z.object({
  bookingId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  signals: z.object({
    accountAgeDays: z.number().int().min(0),
    bookingsLast24h: z.number().int().min(0),
    amountMinor: z.number().int().min(0),
    seatCount: z.number().int().min(0),
    emailDisposable: z.boolean().default(false),
    paymentMethodNew: z.boolean().default(false),
    billingCountryMismatch: z.boolean().default(false),
    nightBooking: z.boolean().default(false),
  }),
});

@ApiTags('fraud')
@ApiBearerAuth('bearer')
@Controller({ path: 'fraud', version: '1' })
@ApiStandardErrors()
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Post('assess')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Score a booking/payment attempt for risk' })
  async assess(@Body(zodBody(AssessSchema)) dto: z.infer<typeof AssessSchema>) {
    return this.fraud.assess({ signals: dto.signals, bookingId: dto.bookingId as BookingId | undefined, customerId: dto.customerId as UserId | undefined });
  }

  @Get('review-queue')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Assessments needing manual review (review/deny)' })
  async queue() {
    return { assessments: await this.fraud.reviewQueue() };
  }

  @Get('bookings/:bookingId')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Latest risk assessment for a booking' })
  async forBooking(@Param('bookingId') bookingId: string) {
    return this.fraud.forBooking(bookingId as BookingId);
  }
}
