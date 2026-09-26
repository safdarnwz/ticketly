import { Body, Controller, Get, HttpCode, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  Idempotent,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
  type DateRangeQuery,
} from '@http';
import { type AgentId } from '@kernel';

import { AgentComplaintService } from '../application/services/agent-complaint.service';
import { AgentService } from '../application/services/agent.service';
import {
  AdjustmentSchema,
  AgentStatusSchema,
  DecideComplaintSchema,
  RaiseComplaintSchema,
  type DecideComplaintDto,
  type RaiseComplaintDto,
  CreateAgentSchema,
  ReceiptSchema,
  SlabsSchema,
  AgentLedgerQuerySchema,
  ListAgentsQuerySchema,
  type AgentLedgerQueryDto,
  type ListAgentsQueryDto,
  UpdateAgentSchema,
  type AdjustmentDto,
  type SlabsDto,
  type AgentStatusDto,
  type CreateAgentDto,
  type ReceiptDto,
  type UpdateAgentDto,
} from './dto/agent.dto';

/** OPERATOR console: manage this operator's B2B travel agents and their accounts. */
@ApiTags('agents')
@ApiBearerAuth('bearer')
@Controller({ path: 'agents', version: '1' })
@ApiStandardErrors()
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly complaintService: AgentComplaintService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.AGENT_MANAGE)
  @Idempotent()
  @ApiOperation({ summary: 'Register an agent with their own login (prepaid or postpaid)' })
  async create(@Body(zodBody(CreateAgentSchema)) dto: CreateAgentDto) {
    return this.agents.create(dto);
  }

  @Get()
  @RequirePermission(Permission.AGENT_READ)
  @ApiOperation({ summary: 'Agents with balance, spendable amount, sales and commission' })
  async list(@Query(zodQuery(ListAgentsQuerySchema)) q: ListAgentsQueryDto) {
    return { items: await this.agents.list(q) };
  }

  @Get('commission-slabs')
  @RequirePermission(Permission.AGENT_READ)
  @ApiOperation({ summary: "Operator's default commission slabs for all agents" })
  async defaultSlabs() {
    return this.agents.getSlabs(null);
  }

  @Put('commission-slabs')
  @RequirePermission(Permission.AGENT_MANAGE)
  @ApiOperation({
    summary:
      'Replace the default slabs (first slab must start at ₹0; rates never decrease). Empty list removes them.',
  })
  async setDefaultSlabs(@Body(zodBody(SlabsSchema)) dto: SlabsDto) {
    await this.agents.setSlabs(null, dto.slabs);
    return { ok: true };
  }

  @Get(':id/commission-slabs')
  @RequirePermission(Permission.AGENT_READ)
  async agentSlabs(@UuidParam('id') id: string) {
    const agent = await this.agents.get(id as AgentId);
    return {
      ...(await this.agents.getSlabs(id as AgentId)),
      currentRate: await this.agents.currentRate(id as AgentId, agent.commissionPct),
    };
  }

  @Put(':id/commission-slabs')
  @RequirePermission(Permission.AGENT_MANAGE)
  @ApiOperation({
    summary: "Replace this agent's own slabs (override the default). Empty list removes them.",
  })
  async setAgentSlabs(@UuidParam('id') id: string, @Body(zodBody(SlabsSchema)) dto: SlabsDto) {
    await this.agents.setSlabs(id as AgentId, dto.slabs);
    return { ok: true };
  }

  @Get(':id')
  @RequirePermission(Permission.AGENT_READ)
  async get(@UuidParam('id') id: string) {
    return this.agents.get(id as AgentId);
  }

  @Patch(':id')
  @RequirePermission(Permission.AGENT_MANAGE)
  @ApiOperation({
    summary:
      'Edit details / terms. A credit limit can never be cut below what the agent already owes.',
  })
  async update(@UuidParam('id') id: string, @Body(zodBody(UpdateAgentSchema)) dto: UpdateAgentDto) {
    await this.agents.update(id as AgentId, dto);
    return { ok: true };
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission(Permission.AGENT_MANAGE)
  @ApiOperation({ summary: 'Approve (active), suspend or reject — suspend/reject need a reason' })
  async setStatus(
    @UuidParam('id') id: string,
    @Body(zodBody(AgentStatusSchema)) dto: AgentStatusDto,
  ) {
    await this.agents.setStatus(id as AgentId, dto.status, dto.reason);
    return { ok: true };
  }

  @Post(':id/receipts')
  @HttpCode(200)
  @RequirePermission(Permission.AGENT_MANAGE)
  @Idempotent()
  @ApiOperation({
    summary:
      'Money received from the agent: prepaid top-up or postpaid payment. Same reference twice = no-op.',
  })
  async receipt(@UuidParam('id') id: string, @Body(zodBody(ReceiptSchema)) dto: ReceiptDto) {
    return this.agents.recordReceipt(id as AgentId, dto);
  }

  @Post(':id/adjustments')
  @HttpCode(200)
  @RequirePermission(Permission.AGENT_MANAGE)
  @Idempotent()
  @ApiOperation({
    summary: 'Manual correction (+/-) with a mandatory reason; can never breach the credit limit',
  })
  async adjust(@UuidParam('id') id: string, @Body(zodBody(AdjustmentSchema)) dto: AdjustmentDto) {
    return this.agents.adjust(id as AgentId, dto);
  }

  @Get(':id/ledger')
  @RequirePermission(Permission.AGENT_READ)
  async ledger(
    @UuidParam('id') id: string,
    @Query(zodQuery(AgentLedgerQuerySchema)) q: AgentLedgerQueryDto,
  ) {
    return { items: await this.agents.ledger(id as AgentId, q) };
  }

  @Get(':id/statement')
  @RequirePermission(Permission.AGENT_READ)
  @ApiOperation({
    summary: 'Period statement: opening, sales, refunds, commission, receipts, closing, amount due',
  })
  async statement(
    @UuidParam('id') id: string,
    @Query(zodQuery(DateRangeQuerySchema)) q: DateRangeQuery,
  ) {
    return this.agents.statement(id as AgentId, q.from, q.to);
  }

  @Get(':id/complaints')
  @RequirePermission(Permission.AGENT_READ)
  @ApiOperation({ summary: 'Formal complaints against this agent, newest first' })
  async complaints(@UuidParam('id') id: string) {
    return { items: await this.complaintService.list(id as AgentId) };
  }

  @Post(':id/complaints')
  @HttpCode(201)
  @RequirePermission(Permission.AGENT_MANAGE)
  @Idempotent()
  @ApiOperation({
    summary: 'Raise a formal complaint (optionally about a booking the agent sold, by PNR)',
  })
  async raiseComplaint(
    @UuidParam('id') id: string,
    @Body(zodBody(RaiseComplaintSchema)) dto: RaiseComplaintDto,
  ) {
    return this.complaintService.raise(id as AgentId, dto);
  }

  @Post(':id/complaints/:complaintId/decision')
  @HttpCode(200)
  @RequirePermission(Permission.AGENT_MANAGE)
  @Idempotent()
  @ApiOperation({ summary: 'Uphold or dismiss a complaint with what was decided (final)' })
  async decideComplaint(
    @UuidParam('id') id: string,
    @UuidParam('complaintId') complaintId: string,
    @Body(zodBody(DecideComplaintSchema)) dto: DecideComplaintDto,
  ) {
    return this.complaintService.decide(id as AgentId, complaintId, dto.outcome, dto.resolution);
  }
}
