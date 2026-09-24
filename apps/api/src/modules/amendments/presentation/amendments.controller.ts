import { z } from 'zod';
import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import { type BookingId, type StopId, type TripId } from '@kernel';

import { AmendmentService } from '../application/services/amendment.service';
import {
  RescheduleSchema,
  type RescheduleDto,
  SeatChangeSchema,
  type SeatChangeDto,
} from './dto/amendments.dto';

const NameCorrectionSchema = z.object({
  seatNumber: z.string().trim().min(1),
  fullName: z.string().trim().min(2).max(120),
});
const PointChangeSchema = z
  .object({ fromStopId: z.string().uuid().optional(), toStopId: z.string().uuid().optional() })
  .refine((d) => d.fromStopId || d.toStopId, {
    message: 'Choose a new boarding and/or dropping point',
  });

@ApiTags('amendments')
@ApiBearerAuth('bearer')
@Controller({ path: 'bookings', version: '1' })
@ApiStandardErrors()
export class AmendmentsController {
  constructor(private readonly amendments: AmendmentService) {}

  @Post(':id/reschedule')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_RESCHEDULE)
  @ApiOperation({ summary: 'Reschedule a booking to a new trip (fare diff + fee)' })
  async reschedule(
    @UuidParam('id') id: string,
    @Body(zodBody(RescheduleSchema)) dto: RescheduleDto,
  ) {
    return this.amendments.reschedule({
      bookingId: id as BookingId,
      newTripId: dto.newTripId as TripId,
      newFromStopId: dto.newFromStopId as StopId,
      newToStopId: dto.newToStopId as StopId,
      newSeatNumbers: dto.newSeatNumbers,
    });
  }

  @Post(':id/change-seats')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_RESCHEDULE)
  @ApiOperation({ summary: 'Change seats within the same trip' })
  async changeSeats(
    @UuidParam('id') id: string,
    @Body(zodBody(SeatChangeSchema)) dto: SeatChangeDto,
  ) {
    return this.amendments.changeSeats(id as BookingId, dto.newSeatNumbers);
  }

  @Post(':id/change-points')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_RESCHEDULE)
  @ApiOperation({
    summary:
      'Change boarding and/or dropping point on the same trip (same fare stage; until 60 min before boarding)',
  })
  async changePoints(
    @UuidParam('id') id: string,
    @Body(zodBody(PointChangeSchema)) dto: z.infer<typeof PointChangeSchema>,
  ) {
    return this.amendments.changePoints(id as BookingId, dto);
  }

  @Post(':id/correct-name')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_RESCHEDULE)
  @ApiOperation({
    summary: 'Correct a passenger name spelling (small edit only — a different person is refused)',
  })
  async correctName(
    @UuidParam('id') id: string,
    @Body(zodBody(NameCorrectionSchema)) dto: z.infer<typeof NameCorrectionSchema>,
  ) {
    return this.amendments.correctName(id as BookingId, dto.seatNumber, dto.fullName);
  }
}
