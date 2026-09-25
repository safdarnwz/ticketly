import { Body, Controller, Get, Header, Post, HttpCode, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Public,
  RateLimit,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { AppError, ErrorCode, newId, type BookingId } from '@kernel';

import { TicketService } from '../application/services/ticket.service';
import {
  ResendTicketSchema,
  TicketAccessQuerySchema,
  VerifyTicketSchema,
  type ResendTicketDto,
  type TicketAccessQueryDto,
  type VerifyTicketDto,
} from './dto/ticket.dto';

@ApiTags('tickets')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class TicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get('bookings/:bookingId/tickets')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary:
      "Signed boarding tokens (QR content) — for the operator's staff, the signed-in customer, or with ?mobile= of the booking",
  })
  async tokens(
    @UuidParam('bookingId') bookingId: string,
    @Query(zodQuery(TicketAccessQuerySchema)) q: TicketAccessQueryDto,
  ) {
    return this.tickets.asViewer(bookingId as BookingId, q.mobile, () =>
      this.tickets.issueForBooking(bookingId as BookingId),
    );
  }

  @Get('bookings/:bookingId/ticket.html')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Printable HTML e-ticket (same access as the tickets endpoint)' })
  async html(
    @UuidParam('bookingId') bookingId: string,
    @Query(zodQuery(TicketAccessQuerySchema)) q: TicketAccessQueryDto,
  ) {
    return this.tickets.asViewer(bookingId as BookingId, q.mobile, () =>
      this.tickets.renderHtml(bookingId as BookingId),
    );
  }

  @Post('bookings/:bookingId/tickets/resend')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_READ)
  @RateLimit(30, 60_000, 'tenant')
  @ApiOperation({
    summary:
      "Operator staff: email the e-ticket again — to the booking's email or another address the customer gives (a confirmed booking of this operator only)",
  })
  async resend(
    @UuidParam('bookingId') bookingId: string,
    @Body(zodBody(ResendTicketSchema)) dto: ResendTicketDto,
  ) {
    const sent = await this.tickets.emailTicket(bookingId as BookingId, newId(), dto.email);
    if (!sent)
      throw new AppError(ErrorCode.COMMON_PRECONDITION_FAILED, 422, {
        message: 'Only a confirmed booking with an email address can be sent its ticket',
      });
    return { sent: true };
  }

  @Post('tickets/verify')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Verify a scanned boarding token (offline-style)' })
  async verify(@Body(zodBody(VerifyTicketSchema)) dto: VerifyTicketDto) {
    const payload = this.tickets.verify(dto.token);
    return { valid: true, payload };
  }
}
