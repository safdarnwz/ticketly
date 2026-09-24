import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';

import { IncidentService } from '../application/incident.service';
import { DELAY_CATEGORIES, INCIDENT_TYPES } from '../domain/incident-rules';

const ReportSchema = z.object({
  tripId: z.string().uuid().optional(),
  type: z.enum(INCIDENT_TYPES),
  description: z.string().trim().max(2000).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  delayCategory: z.enum(DELAY_CATEGORIES).optional(),
  delayMinutes: z.number().int().optional(),
  diversionVia: z.string().trim().max(300).optional(),
});
const SosSchema = z.object({
  kind: z.enum(['sos', 'medical', 'security', 'accident']).default('sos'),
  lat: z.number().optional(),
  lng: z.number().optional(),
  description: z.string().trim().max(500).optional(),
});
const TransitionSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'closed']),
  note: z.string().trim().max(2000).optional(),
});
const ItemSchema = z.object({
  tripId: z.string().uuid().optional(),
  description: z.string().trim().min(3).max(500),
  seatNumber: z.string().trim().max(10).optional(),
  storedAt: z.string().trim().max(120).optional(),
});
const ClaimSchema = z.object({
  claimantName: z.string().trim().min(2).max(120),
  pnr: z.string().trim().max(20).optional(),
});
const NoteSchema = z.object({
  scope: z.enum(['dispatch', 'branch']),
  note: z.string().trim().min(2).max(4000),
  branchId: z.string().uuid().optional(),
});

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
  report(@Body(zodBody(ReportSchema)) dto: z.infer<typeof ReportSchema>) {
    return this.svc.report(dto);
  }

  @Get('incidents')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Incidents (status=active for open+acknowledged); critical first, with overdue flag',
  })
  async list(@Query('status') status?: string, @Query('tripId') tripId?: string) {
    return { items: await this.svc.list({ status, tripId }) };
  }

  @Post('incidents/:id/status')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  transition(
    @UuidParam('id') id: string,
    @Body(zodBody(TransitionSchema)) dto: z.infer<typeof TransitionSchema>,
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
  sos(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(SosSchema)) dto: z.infer<typeof SosSchema>,
  ) {
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
  @RequirePermission(Permission.TRIP_OPERATE)
  logItem(@Body(zodBody(ItemSchema)) dto: z.infer<typeof ItemSchema>) {
    return this.svc.logItem(dto);
  }

  @Get('lost-found')
  @RequirePermission(Permission.TRIP_OPERATE)
  async items(@Query('status') status?: string) {
    return { items: await this.svc.listItems(status) };
  }

  @Post('lost-found/:id/claim')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Hand an item back — claimant must hold a PNR for the trip it was found on',
  })
  claim(@UuidParam('id') id: string, @Body(zodBody(ClaimSchema)) dto: z.infer<typeof ClaimSchema>) {
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
  @RequirePermission(Permission.TRIP_OPERATE)
  addNote(@Body(zodBody(NoteSchema)) dto: z.infer<typeof NoteSchema>) {
    return this.svc.addNote(dto.scope, dto.note, dto.branchId);
  }

  @Get('shift-notes')
  @RequirePermission(Permission.TRIP_OPERATE)
  async notes(@Query('scope') scope: string, @Query('branchId') branchId?: string) {
    return { items: await this.svc.notes(scope === 'branch' ? 'branch' : 'dispatch', branchId) };
  }

  @Get('reports/dispatch')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary:
      'On-time %, average delay, delayed trips, bus utilization, crew performance for a period',
  })
  dispatch(@Query('from') from: string, @Query('to') to: string) {
    return this.svc.dispatchReport(from, to);
  }
}
