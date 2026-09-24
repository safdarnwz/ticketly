import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, zodBody } from '@http';
import { AppError, ErrorCode, getUserId } from '@kernel';

import { PlatformSettingsRepository } from '../../platform-settings';
import {
  MAINTENANCE_KEY,
  MaintenanceGuard,
  type MaintenanceState,
} from './guards/maintenance.guard';
import { MaintenanceModeSchema, type MaintenanceModeDto } from './dto/maintenance.dto';

@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/platform/maintenance', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class MaintenanceController {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    private readonly guard: MaintenanceGuard,
  ) {}

  @Get()
  get() {
    return this.settings.get<MaintenanceState>(MAINTENANCE_KEY, { enabled: false });
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
