import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  Idempotent,
  OptionalDateRangeQuerySchema,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
  type DateRangeQuery,
  type OptionalDateRangeQuery,
} from '@http';
import { type BookingId } from '@kernel';

import {
  AmendmentService,
  NameCorrectionSchema,
  PointChangeSchema,
  SeatChangeSchema,
  type NameCorrectionDto,
  type PointChangeDto,
  type SeatChangeDto,
} from '../../amendments';
import { AgentService } from '../application/services/agent.service';
import {
  AgentBookingsQuerySchema,
  AgentBookSchema,
  AgentCancelSchema,
  type AgentBookDto,
  type AgentBookingsQueryDto,
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
  @ApiOperation({
    summary:
      "My account: status, balance, spendable, credit limit, commission %, the operator's contacts",
  })
  async me() {
    const me = await this.agents.me();
    const [currentCommission, operator] = await Promise.all([
      this.agents.currentRate(me.id, me.commissionPct),
      this.agents.operatorContact(),
    ]);
    return { ...me, currentCommission, operator };
  }

  @Get('ledger')
  async ledger(@Query(zodQuery(OptionalDateRangeQuerySchema)) q: OptionalDateRangeQuery) {
    const me = await this.agents.me();
    return { items: await this.agents.ledger(me.id, { ...q, limit: 500 }) };
  }

  @Get('statement')
  async statement(@Query(zodQuery(DateRangeQuerySchema)) q: DateRangeQuery) {
    const me = await this.agents.me();
    return this.agents.statement(me.id, q.from, q.to);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'My bookings; optional from/to (YYYY-MM-DD) for today / week / month history',
  })
  async bookings(@Query(zodQuery(AgentBookingsQuerySchema)) q: AgentBookingsQueryDto) {
    if (q.from || q.to) return { items: await this.agents.myBookingsInPeriod(q.from, q.to) };
    return { items: await this.agents.myBookings({ status: q.status, limit: 200 }) };
  }

  @Post('bookings/:id/change-points')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({ summary: 'Change boarding / dropping point on my booking (same fare stage)' })
  async changePoints(
    @UuidParam('id') id: string,
    @Body(zodBody(PointChangeSchema)) dto: PointChangeDto,
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.changePoints(id as BookingId, dto);
  }

  @Post('bookings/:id/change-seats')
  @HttpCode(200)
  @Idempotent()
  async changeSeats(
    @UuidParam('id') id: string,
    @Body(zodBody(SeatChangeSchema)) dto: SeatChangeDto,
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.changeSeats(id as BookingId, dto.newSeatNumbers);
  }

  @Post('bookings/:id/correct-name')
  @HttpCode(200)
  @Idempotent()
  async correctName(
    @UuidParam('id') id: string,
    @Body(zodBody(NameCorrectionSchema)) dto: NameCorrectionDto,
  ) {
    await this.agents.assertMyBooking(id as BookingId);
    return this.amendments.correctName(id as BookingId, dto.seatNumber, dto.fullName);
  }

  @Get('bookings/:id')
  async booking(@UuidParam('id') id: string) {
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
  async cancel(@UuidParam('id') id: string, @Body(zodBody(AgentCancelSchema)) dto: AgentCancelDto) {
    return this.agents.agentCancel(id as BookingId, dto);
  }
}
