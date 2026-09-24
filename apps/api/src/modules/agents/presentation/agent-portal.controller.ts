import { z } from 'zod';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import { BadRequestError, type BookingId } from '@kernel';

import { AmendmentService } from '../../amendments/application/services/amendment.service';
import { AgentService } from '../application/services/agent.service';
import {
  AgentBookSchema,
  AgentCancelSchema,
  type AgentBookDto,
  type AgentCancelDto,
} from './dto/agent.dto';

/**
 * AGENT self-service. Every route resolves "which agent am I" from the
 * logged-in user (AgentService.me) — never from a path/body parameter — so an
 * agent can only ever see and act on their OWN account and bookings.
 * Search, seat map and price quote use the existing public endpoints.
 */
@ApiTags('agent-portal')
@ApiBearerAuth('bearer')
@Controller({ path: 'agent-portal', version: '1' })
@ApiStandardErrors()
@RequirePermission(Permission.AGENT_PORTAL)
export class AgentPortalController {
  constructor(
    private readonly agents: AgentService,
    private readonly amendments: AmendmentService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'My account: status, balance, spendable, credit limit, commission %' })
  async me() {
    const me = await this.agents.me();
    return { ...me, currentCommission: await this.agents.currentRate(me.id, me.commissionPct) };
  }

  @Get('ledger')
  async ledger(@Query('from') from?: string, @Query('to') to?: string) {
    const me = await this.agents.me();
    return { items: await this.agents.ledger(me.id, { from, to, limit: 500 }) };
  }

  @Get('statement')
  async statement(@Query('from') from: string, @Query('to') to: string) {
    const me = await this.agents.me();
    return this.agents.statement(me.id, from, to);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'My bookings; optional from/to (YYYY-MM-DD) for today / week / month history',
  })
  async bookings(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !ymd.test(from)) || (to && !ymd.test(to)) || (from && to && from > to))
      throw new BadRequestError('from/to must be YYYY-MM-DD with from ≤ to');
    if (from || to) return { items: await this.agents.myBookingsInPeriod(from, to) };
    return { items: await this.agents.myBookings({ status, limit: 200 }) };
  }

  @Post('bookings/:id/change-points')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({ summary: 'Change boarding / dropping point on my booking (same fare stage)' })
  async changePoints(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          fromStopId: z.string().uuid().optional(),
          toStopId: z.string().uuid().optional(),
        }),
      ),
    )
    dto: { fromStopId?: string; toStopId?: string },
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.changePoints(id as BookingId, dto);
  }

  @Post('bookings/:id/change-seats')
  @HttpCode(200)
  @Idempotent()
  async changeSeats(
    @Param('id') id: string,
    @Body(zodBody(z.object({ newSeatNumbers: z.array(z.string().trim().min(1)).min(1).max(10) })))
    dto: { newSeatNumbers: string[] },
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.changeSeats(id as BookingId, dto.newSeatNumbers);
  }

  @Post('bookings/:id/correct-name')
  @HttpCode(200)
  @Idempotent()
  async correctName(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          seatNumber: z.string().trim().min(1),
          fullName: z.string().trim().min(2).max(120),
        }),
      ),
    )
    dto: { seatNumber: string; fullName: string },
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.correctName(id as BookingId, dto.seatNumber, dto.fullName);
  }

  @Get('bookings/:id')
  async booking(@Param('id') id: string) {
    return this.agents.myBooking(id as BookingId);
  }

  @Post('bookings')
  @HttpCode(201)
  @Idempotent()
  @ApiOperation({
    summary:
      'Sell seats: hold → debit my account (net of commission) → ticket issued. 402 if balance/credit is short.',
  })
  async book(@Body(zodBody(AgentBookSchema)) dto: AgentBookDto) {
    return this.agents.agentBook(dto);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary: 'Cancel my booking (all or some seats). The refund is credited to my account.',
  })
  async cancel(@Param('id') id: string, @Body(zodBody(AgentCancelSchema)) dto: AgentCancelDto) {
    return this.agents.agentCancel(id as BookingId, dto);
  }
}
