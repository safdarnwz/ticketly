import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
} from '@http';
import { type BookingId, type UserId } from '@kernel';

import { FraudService } from '../application/services/fraud.service';
import { FraudAssessmentSchema, type FraudAssessmentDto } from './dto/fraud.dto';

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
  async assess(@Body(zodBody(FraudAssessmentSchema)) dto: FraudAssessmentDto) {
    return this.fraud.assess({
      signals: dto.signals,
      bookingId: dto.bookingId as BookingId | undefined,
      customerId: dto.customerId as UserId | undefined,
    });
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
  async forBooking(@UuidParam('bookingId') bookingId: string) {
    return this.fraud.forBooking(bookingId as BookingId);
  }
}
