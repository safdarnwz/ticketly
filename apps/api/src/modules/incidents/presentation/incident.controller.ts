import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
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

import { IncidentService } from '../application/incident.service';
import {
  ClaimLostItemSchema,
  HandoverNoteSchema,
  HandoverNotesQuerySchema,
  IncidentTransitionSchema,
  ListIncidentsQuerySchema,
  ListLostItemsQuerySchema,
  LostItemSchema,
  ReportIncidentSchema,
  SosSchema,
  type ClaimLostItemDto,
  type HandoverNoteDto,
  type HandoverNotesQueryDto,
  type IncidentTransitionDto,
  type ListIncidentsQueryDto,
  type ListLostItemsQueryDto,
  type LostItemDto,
  type ReportIncidentDto,
  type SosDto,
} from './dto/incident.dto';

/** Dispatch / branch console: incidents, lost & found, shift handover, dispatch report. */
@ApiTags('incidents')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class IncidentController {
  constructor(private readonly svc: IncidentService) {}

  @Post('incidents')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary:
      'Report an incident: breakdown, delay (with category), diversion, medical, security, accident, complaint',
  })
  report(@Body(zodBody(ReportIncidentSchema)) dto: ReportIncidentDto) {
    return this.svc.report(dto);
  }

  @Get('incidents')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Incidents (status=active for open+acknowledged); critical first, with overdue flag',
  })
  async list(@Query(zodQuery(ListIncidentsQuerySchema)) q: ListIncidentsQueryDto) {
    return { items: await this.svc.list(q) };
  }

  @Post('incidents/:id/status')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  transition(
    @UuidParam('id') id: string,
    @Body(zodBody(IncidentTransitionSchema)) dto: IncidentTransitionDto,
  ) {
    return this.svc.transition(id, dto.status, dto.note);
  }

  @Post('crew/trips/:tripId/sos')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary:
      'Panic button from the crew app — one tap, location optional, alerts the emergency team at once',
  })
  sos(@UuidParam('tripId') tripId: string, @Body(zodBody(SosSchema)) dto: SosDto) {
    return this.svc.report({
      tripId,
      type: dto.kind,
      lat: dto.lat,
      lng: dto.lng,
      description: dto.description,
    });
  }

  @Post('lost-found')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  logItem(@Body(zodBody(LostItemSchema)) dto: LostItemDto) {
    return this.svc.logItem(dto);
  }

  @Get('lost-found')
  @RequirePermission(Permission.TRIP_OPERATE)
  async items(@Query(zodQuery(ListLostItemsQuerySchema)) q: ListLostItemsQueryDto) {
    return { items: await this.svc.listItems(q.status) };
  }

  @Post('lost-found/:id/claim')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Hand an item back — claimant must hold a PNR for the trip it was found on',
  })
  claim(@UuidParam('id') id: string, @Body(zodBody(ClaimLostItemSchema)) dto: ClaimLostItemDto) {
    return this.svc.claimItem(id, dto);
  }

  @Post('lost-found/:id/dispose')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  dispose(@UuidParam('id') id: string) {
    return this.svc.disposeItem(id);
  }

  @Post('shift-notes')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  addNote(@Body(zodBody(HandoverNoteSchema)) dto: HandoverNoteDto) {
    return this.svc.addNote(dto.scope, dto.note, dto.branchId);
  }

  @Get('shift-notes')
  @RequirePermission(Permission.TRIP_OPERATE)
  async notes(@Query(zodQuery(HandoverNotesQuerySchema)) q: HandoverNotesQueryDto) {
    return { items: await this.svc.notes(q.scope, q.branchId) };
  }

  @Get('reports/dispatch')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary:
      'On-time %, average delay, delayed trips, bus utilization, crew performance for a period',
  })
  dispatch(@Query(zodQuery(DateRangeQuerySchema)) q: DateRangeQuery) {
    return this.svc.dispatchReport(q.from, q.to);
  }
}
