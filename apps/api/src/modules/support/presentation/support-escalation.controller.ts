import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, UuidParam, zodBody, zodQuery } from '@http';

import { SupportService } from '../application/services/support.service';
import {
  ListEscalationsQuerySchema,
  SupportReplySchema,
  type ListEscalationsQueryDto,
  type SupportReplyDto,
} from './dto/support.dto';

/** The platform's support desk: tickets operators escalated, across every operator. */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/support/escalations', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class SupportEscalationController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'Escalations from every operator, those waiting on the platform first' })
  async list(@Query(zodQuery(ListEscalationsQuerySchema)) q: ListEscalationsQueryDto) {
    return { items: await this.support.listEscalations(q) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One escalated ticket with its whole thread' })
  async get(@UuidParam('id') id: string) {
    return this.support.escalation(id);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Answer the operator (they see it on the ticket)' })
  async reply(
    @UuidParam('id') id: string,
    @Body(zodBody(SupportReplySchema)) dto: SupportReplyDto,
  ) {
    return this.support.answerEscalation(id, dto.body);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close the escalation (the operator can escalate again)' })
  async close(@UuidParam('id') id: string) {
    return this.support.closeEscalation(id);
  }
}
