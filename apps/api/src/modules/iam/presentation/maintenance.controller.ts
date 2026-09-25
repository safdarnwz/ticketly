import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, UuidParam, zodBody, zodQuery } from '@http';
import { AppError, ErrorCode, getUserId } from '@kernel';

import { PlatformSettingsRepository } from '../../platform-settings';
import {
  MAINTENANCE_KEY,
  MaintenanceGuard,
  type MaintenanceState,
} from './guards/maintenance.guard';
import {
  MaintenanceModeSchema,
  MaintenanceWindowListQuerySchema,
  ScheduleMaintenanceSchema,
  type MaintenanceModeDto,
  type MaintenanceWindowListQueryDto,
  type ScheduleMaintenanceDto,
} from './dto/maintenance.dto';
import { MaintenanceWindowService } from '../application/services/maintenance-window.service';

@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/platform/maintenance', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class MaintenanceController {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    private readonly guard: MaintenanceGuard,
    private readonly windowService: MaintenanceWindowService,
  ) {}

  @Get()
  get() {
    return this.settings.get<MaintenanceState>(MAINTENANCE_KEY, { enabled: false });
  }

  @Get('windows')
  @ApiOperation({
    summary: 'Scheduled maintenance windows (upcoming and running; ?includePast=1 for all)',
  })
  async windows(
    @Query(zodQuery(MaintenanceWindowListQuerySchema)) q: MaintenanceWindowListQueryDto,
  ) {
    return { items: await this.windowService.list(q.includePast) };
  }

  @Post('windows')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Schedule maintenance: while it runs, writes get a retryable 503 (optionally email every operator now)',
  })
  schedule(@Body(zodBody(ScheduleMaintenanceSchema)) dto: ScheduleMaintenanceDto) {
    return this.windowService.schedule(dto, getUserId() ?? null);
  }

  @Post('windows/:id/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email every active operator about this maintenance window' })
  notify(@UuidParam('id') id: string) {
    return this.windowService.notify(id, getUserId() ?? null);
  }

  @Post('windows/:id/cancel')
  @HttpCode(200)
  async cancel(@UuidParam('id') id: string) {
    await this.windowService.cancel(id);
    this.guard.invalidate();
    return { ok: true };
  }

  @Put()
  @ApiOperation({
    summary:
      'Turn maintenance mode on/off (writes return 503 + Retry-After; reads, webhooks and platform admins keep working)',
  })
  async set(@Body(zodBody(MaintenanceModeSchema)) dto: MaintenanceModeDto) {
    if (dto.enabled && dto.until && Date.parse(dto.until) <= Date.now()) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'The expected end time must be in the future',
      });
    }
    const state: MaintenanceState = {
      enabled: dto.enabled,
      message: dto.message,
      until: dto.enabled ? (dto.until ?? null) : null,
    };
    await this.settings.set(MAINTENANCE_KEY, state, getUserId() ?? null);
    this.guard.invalidate();
    return state;
  }
}
