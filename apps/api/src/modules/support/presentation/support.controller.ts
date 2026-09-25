import { Body, Controller, Get, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody, zodQuery } from '@http';
import { type BookingId, type SupportTicketId } from '@kernel';

import { SupportService } from '../application/services/support.service';
import {
  ListSupportTicketsQuerySchema,
  OpenSupportTicketSchema,
  SupportReplySchema,
  SupportTransitionSchema,
  UpdateTicketSchema,
  type ListSupportTicketsQueryDto,
  type UpdateTicketDto,
  type OpenSupportTicketDto,
  type SupportReplyDto,
  type SupportTransitionDto,
} from './dto/support.dto';

@ApiTags('support')
@ApiBearerAuth('bearer')
/**
 * One set of endpoints for both sides: signed-in customers see and answer only
 * their own tickets; operator staff see and work all of the operator's. Who
 * wrote a message comes from the account, never from the request.
 */
@Controller({ path: 'support/tickets', version: '1' })
@ApiStandardErrors()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Open a support ticket' })
  async open(@Body(zodBody(OpenSupportTicketSchema)) dto: OpenSupportTicketDto) {
    return this.support.open({
      subject: dto.subject,
      body: dto.body,
      category: dto.category,
      priority: dto.priority,
      bookingId: dto.bookingId as BookingId | undefined,
      pnr: dto.pnr,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List support tickets' })
  async list(@Query(zodQuery(ListSupportTicketsQuerySchema)) q: ListSupportTicketsQueryDto) {
    return { tickets: await this.support.list(q) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a ticket with its message thread' })
  async get(@UuidParam('id') id: string) {
    return this.support.get(id as SupportTicketId);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reply on a ticket' })
  async reply(
    @UuidParam('id') id: string,
    @Body(zodBody(SupportReplySchema)) dto: SupportReplyDto,
  ) {
    return this.support.reply(id as SupportTicketId, { body: dto.body });
  }

  @Patch(':id')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Staff: change priority or assignee' })
  async update(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateTicketSchema)) dto: UpdateTicketDto,
  ) {
    await this.support.update(id as SupportTicketId, dto);
    return { ok: true };
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change a ticket status' })
  async transition(
    @UuidParam('id') id: string,
    @Body(zodBody(SupportTransitionSchema)) dto: SupportTransitionDto,
  ) {
    return this.support.transition(id as SupportTicketId, dto.status);
  }
}
