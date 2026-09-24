import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody, zodQuery } from '@http';
import { type BookingId, type SupportTicketId, type UserId } from '@kernel';

import { SupportService } from '../application/services/support.service';
import {
  ListSupportTicketsQuerySchema,
  OpenSupportTicketSchema,
  SupportReplySchema,
  SupportTransitionSchema,
  type ListSupportTicketsQueryDto,
  type OpenSupportTicketDto,
  type SupportReplyDto,
  type SupportTransitionDto,
} from './dto/support.dto';

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
  async open(@Body(zodBody(OpenSupportTicketSchema)) dto: OpenSupportTicketDto) {
    return this.support.open({
      subject: dto.subject,
      body: dto.body,
      category: dto.category,
      priority: dto.priority,
      bookingId: dto.bookingId as BookingId | undefined,
    });
  }

  @Get()
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'List support tickets' })
  async list(@Query(zodQuery(ListSupportTicketsQuerySchema)) q: ListSupportTicketsQueryDto) {
    return {
      tickets: await this.support.list({
        status: q.status,
        customerId: q.customerId as UserId | undefined,
      }),
    };
  }

  @Get(':id')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Get a ticket with its message thread' })
  async get(@UuidParam('id') id: string) {
    return this.support.get(id as SupportTicketId);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Reply on a ticket' })
  async reply(
    @UuidParam('id') id: string,
    @Body(zodBody(SupportReplySchema)) dto: SupportReplyDto,
  ) {
    return this.support.reply(id as SupportTicketId, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Change a ticket status' })
  async transition(
    @UuidParam('id') id: string,
    @Body(zodBody(SupportTransitionSchema)) dto: SupportTransitionDto,
  ) {
    return this.support.transition(id as SupportTicketId, dto.status);
  }
}
