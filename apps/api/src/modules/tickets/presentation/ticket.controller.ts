import { Body, Controller, Get, Header, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RateLimit, RequirePermission, UuidParam, zodBody } from '@http';
import { type BookingId } from '@kernel';

import { TicketService } from '../application/services/ticket.service';

const VerifySchema = z.object({ token: z.string().min(10).max(4000) });

@ApiTags('tickets')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class TicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get('bookings/:bookingId/tickets')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({ summary: 'Signed boarding tokens (QR content) for a booking' })
  async tokens(@UuidParam('bookingId') bookingId: string) {
    return this.tickets.issueForBooking(bookingId as BookingId);
  }

  @Get('bookings/:bookingId/ticket.html')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Printable HTML e-ticket' })
  async html(@UuidParam('bookingId') bookingId: string) {
    return this.tickets.renderHtml(bookingId as BookingId);
  }

  @Post('tickets/verify')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Verify a scanned boarding token (offline-style)' })
  async verify(@Body(zodBody(VerifySchema)) dto: z.infer<typeof VerifySchema>) {
    const payload = this.tickets.verify(dto.token);
    return { valid: true, payload };
  }
}
