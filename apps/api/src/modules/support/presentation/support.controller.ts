import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';
import { type BookingId, type SupportTicketId, type UserId } from '@kernel';

import { SupportService } from '../application/services/support.service';
import type { TicketStatus } from '../domain/ticket-state';

const OpenTicketSchema = z.object({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  category: z.enum(['refund', 'booking', 'payment', 'general']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  bookingId: z.string().uuid().optional(),
});
const ReplySchema = z.object({
  authorKind: z.enum(['customer', 'agent', 'system']).default('customer'),
  body: z.string().min(1).max(4000),
});
const TransitionSchema = z.object({ status: z.enum(['open', 'pending', 'resolved', 'closed']) });

@ApiTags('support')
@ApiBearerAuth('bearer')
@Controller({ path: 'support/tickets', version: '1' })
@ApiStandardErrors()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Open a support ticket' })
  async open(@Body(zodBody(OpenTicketSchema)) dto: z.infer<typeof OpenTicketSchema>) {
    return this.support.open({ subject: dto.subject, body: dto.body, category: dto.category, priority: dto.priority, bookingId: dto.bookingId as BookingId | undefined });
  }

  @Get()
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'List support tickets' })
  async list(@Query('status') status?: string, @Query('customerId') customerId?: string) {
    return { tickets: await this.support.list({ status: status as TicketStatus | undefined, customerId: customerId as UserId | undefined }) };
  }

  @Get(':id')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Get a ticket with its message thread' })
  async get(@Param('id') id: string) {
    return this.support.get(id as SupportTicketId);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Reply on a ticket' })
  async reply(@Param('id') id: string, @Body(zodBody(ReplySchema)) dto: z.infer<typeof ReplySchema>) {
    return this.support.reply(id as SupportTicketId, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Change a ticket status' })
  async transition(@Param('id') id: string, @Body(zodBody(TransitionSchema)) dto: z.infer<typeof TransitionSchema>) {
    return this.support.transition(id as SupportTicketId, dto.status);
  }
}
