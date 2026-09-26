import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { type BookingId, type StopId, type TripId } from '@kernel';

import { BookingAccess } from '../../booking';
import { AmendmentService } from '../application/services/amendment.service';
import {
  NameCorrectionSchema,
  PointChangeSchema,
  RescheduleOptionsQuerySchema,
  RescheduleQuoteQuerySchema,
  RescheduleSchema,
  SeatChangeSchema,
  type NameCorrectionDto,
  type PointChangeDto,
  type RescheduleDto,
  type RescheduleOptionsQueryDto,
  type RescheduleQuoteQueryDto,
  type SeatChangeDto,
} from './dto/amendments.dto';

/**
 * Changes to a booking after it is paid. Each route serves the operator's staff
 * (`booking:reschedule`, their own bookings), the signed-in customer who booked
 * it, and a guest who gives the booking mobile — see BookingAccess.
 */
@ApiTags('amendments')
@ApiBearerAuth('bearer')
@Controller({ path: 'bookings', version: '1' })
@ApiStandardErrors()
export class AmendmentsController {
  constructor(
    private readonly amendments: AmendmentService,
    private readonly access: BookingAccess,
  ) {}

  private asOwner<T>(id: string, mobile: string | undefined, fn: () => Promise<T>): Promise<T> {
    return this.access.run(id, mobile, Permission.BOOKING_RESCHEDULE, fn);
  }

  @Get(':id/reschedule-options')
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({
    summary:
      "The operator's other buses on a day through this booking's boarding and dropping points, with free seats on that stretch",
  })
  async rescheduleOptions(
    @UuidParam('id') id: string,
    @Query(zodQuery(RescheduleOptionsQuerySchema)) q: RescheduleOptionsQueryDto,
  ) {
    return this.asOwner(id, q.mobile, () =>
      this.amendments.rescheduleOptions(id as BookingId, q.date),
    );
  }

  @Get(':id/reschedule-quote')
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({
    summary:
      'What moving this booking to another trip / date would cost now (fee, fare difference, to pay or refund) — nothing changes',
  })
  async rescheduleQuote(
    @UuidParam('id') id: string,
    @Query(zodQuery(RescheduleQuoteQuerySchema)) q: RescheduleQuoteQueryDto,
  ) {
    return this.asOwner(id, q.mobile, () =>
      this.amendments.reschedule({
        bookingId: id as BookingId,
        newTripId: q.newTripId as TripId,
        newFromStopId: q.newFromStopId as StopId,
        newToStopId: q.newToStopId as StopId,
        newSeatNumbers: q.seats,
        preview: true,
      }),
    );
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({
    summary:
      'Reschedule a booking to a new trip (fare diff + fee); when money is due the result carries the payment and the booking moves once it is paid',
  })
  async reschedule(
    @UuidParam('id') id: string,
    @Body(zodBody(RescheduleSchema)) dto: RescheduleDto,
  ) {
    return this.asOwner(id, dto.mobile, () =>
      this.amendments.reschedule({
        bookingId: id as BookingId,
        newTripId: dto.newTripId as TripId,
        newFromStopId: dto.newFromStopId as StopId,
        newToStopId: dto.newToStopId as StopId,
        newSeatNumbers: dto.newSeatNumbers,
      }),
    );
  }

  @Post(':id/change-seats')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({ summary: 'Change seats within the same trip' })
  async changeSeats(
    @UuidParam('id') id: string,
    @Body(zodBody(SeatChangeSchema)) dto: SeatChangeDto,
  ) {
    return this.asOwner(id, dto.mobile, () =>
      this.amendments.changeSeats(id as BookingId, dto.newSeatNumbers),
    );
  }

  @Post(':id/change-points')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({
    summary:
      'Change boarding and/or dropping point on the same trip (same fare stage; until 60 min before boarding)',
  })
  async changePoints(
    @UuidParam('id') id: string,
    @Body(zodBody(PointChangeSchema)) dto: PointChangeDto,
  ) {
    return this.asOwner(id, dto.mobile, () =>
      this.amendments.changePoints(id as BookingId, {
        fromStopId: dto.fromStopId,
        toStopId: dto.toStopId,
      }),
    );
  }

  @Post(':id/correct-name')
  @HttpCode(200)
  @Public()
  @RateLimit(20, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({
    summary: 'Correct a passenger name spelling (small edit only — a different person is refused)',
  })
  async correctName(
    @UuidParam('id') id: string,
    @Body(zodBody(NameCorrectionSchema)) dto: NameCorrectionDto,
  ) {
    return this.asOwner(id, dto.mobile, () =>
      this.amendments.correctName(id as BookingId, dto.seatNumber, dto.fullName),
    );
  }
}
