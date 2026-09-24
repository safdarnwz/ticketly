import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiStandardErrors, zodBody } from '@http';
import { AppError, ErrorCode, getUserId } from '@kernel';

import { PlatformSettingsRepository } from '../../tenancy/infrastructure/persistence/platform-settings.repository';
import { RequirePlatformAdmin } from './decorators/require-platform-admin.decorator';
import { MAINTENANCE_KEY, MaintenanceGuard, type MaintenanceState } from './guards/maintenance.guard';

const Schema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
  /** Expected end, ISO date-time — shown to users and used for Retry-After. */
  until: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/platform/maintenance', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class MaintenanceController {
  constructor(private readonly settings: PlatformSettingsRepository, private readonly guard: MaintenanceGuard) {}

  @Get()
  get() { return this.settings.get<MaintenanceState>(MAINTENANCE_KEY, { enabled: false }); }

  @Put()
  @ApiOperation({ summary: 'Turn maintenance mode on/off (writes return 503 + Retry-After; reads, webhooks and platform admins keep working)' })
  async set(@Body(zodBody(Schema)) dto: z.infer<typeof Schema>) {
    if (dto.enabled && dto.until && Date.parse(dto.until) <= Date.now()) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'The expected end time must be in the future' });
    }
    const state: MaintenanceState = { enabled: dto.enabled, message: dto.message, until: dto.enabled ? dto.until ?? null : null };
    await this.settings.set(MAINTENANCE_KEY, state, getUserId() ?? null);
    this.guard.invalidate();
    return state;
  }
}
