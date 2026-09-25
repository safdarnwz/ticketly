import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import { BadRequestError, type RouteId, type ServiceId, type TripId } from '@kernel';

import type { RecurrenceRule } from '../domain/recurrence';
import { TimetableService } from '../application/services/timetable.service';
import {
  BlackoutSchema,
  CloneServiceSchema,
  RemoveBlackoutSchema,
  RetimeTripSchema,
  UpdateTimetableSchema,
  type BlackoutDto,
  type CloneServiceDto,
  type RemoveBlackoutDto,
  type RetimeTripDto,
  type UpdateTimetableDto,
} from './dto/scheduling.dto';

/** Service timetables, their history, clones and blackouts; re-timing one trip. */
@ApiTags('scheduling')
@ApiBearerAuth('bearer')
@Controller({ path: 'scheduling', version: '1' })
@ApiStandardErrors()
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Patch('services/:id')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Change departure time, recurrence or bus of a service (saved as a new version; applies to trips created from now on)',
  })
  update(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateTimetableSchema)) dto: UpdateTimetableDto,
  ) {
    return this.timetable.updateTimetable(id as ServiceId, {
      ...dto,
      recurrence: dto.recurrence as RecurrenceRule | undefined,
    });
  }

  @Get('services/:id/versions')
  @RequirePermission(Permission.SERVICE_READ)
  @ApiOperation({ summary: 'Every timetable version of a service, newest first' })
  async versions(@UuidParam('id') id: string) {
    return { items: await this.timetable.listVersions(id as ServiceId) };
  }

  @Post('services/:id/versions/:versionNumber/restore')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary: 'Roll the timetable back to an earlier version (recorded as a new version)',
  })
  restore(@UuidParam('id') id: string, @Param('versionNumber') versionNumber: string) {
    const n = Number(versionNumber);
    if (!Number.isInteger(n) || n < 1)
      throw new BadRequestError('versionNumber is a positive integer');
    return this.timetable.restoreVersion(id as ServiceId, n);
  }

  @Post('services/:id/clone')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Copy a service to new dates as a draft; with season=true the original skips those dates',
  })
  clone(@UuidParam('id') id: string, @Body(zodBody(CloneServiceSchema)) dto: CloneServiceDto) {
    return this.timetable.clone(id as ServiceId, dto);
  }

  @Delete('services/:id')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary: 'Permanently delete a service and its trips — only one that never sold or ran',
  })
  remove(@UuidParam('id') id: string) {
    return this.timetable.deleteService(id as ServiceId);
  }

  @Post('trips/:id/retime')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  @ApiOperation({ summary: 'Move one trip to a new departure time; every passenger is told' })
  retime(@UuidParam('id') id: string, @Body(zodBody(RetimeTripSchema)) dto: RetimeTripDto) {
    return this.timetable.retimeTrip(id as TripId, dto);
  }

  @Get('routes/:routeId/blackouts')
  @RequirePermission(Permission.SERVICE_READ)
  async blackouts(@UuidParam('routeId') routeId: string) {
    return { items: await this.timetable.listBlackouts(routeId as RouteId) };
  }

  @Post('routes/:routeId/blackouts')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Stop a route on some dates: unbooked trips are cancelled, booked ones are listed for you to handle',
  })
  addBlackout(
    @UuidParam('routeId') routeId: string,
    @Body(zodBody(BlackoutSchema)) dto: BlackoutDto,
  ) {
    return this.timetable.addBlackout(routeId as RouteId, dto.dates, dto.reason);
  }

  @Post('routes/:routeId/blackouts/remove')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_MANAGE)
  removeBlackout(
    @UuidParam('routeId') routeId: string,
    @Body(zodBody(RemoveBlackoutSchema)) dto: RemoveBlackoutDto,
  ) {
    return this.timetable.removeBlackout(routeId as RouteId, dto.dates);
  }
}
