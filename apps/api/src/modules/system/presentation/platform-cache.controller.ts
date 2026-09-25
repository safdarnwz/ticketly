import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, zodBody } from '@http';

import {
  CLEARABLE_CACHE_NAMESPACES,
  PlatformCacheService,
} from '../application/platform-cache.service';
import { ClearCacheSchema, type ClearCacheDto } from './dto/platform-cache.dto';

/** Platform cache flush (#116). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/platform/cache', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class PlatformCacheController {
  constructor(private readonly cache: PlatformCacheService) {}

  @Get()
  @ApiOperation({ summary: 'Cache namespaces that can be cleared' })
  namespaces() {
    return { namespaces: CLEARABLE_CACHE_NAMESPACES };
  }

  @Post('clear')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Clear platform caches (all, or the given namespaces) on every instance',
  })
  clear(@Body(zodBody(ClearCacheSchema)) dto: ClearCacheDto) {
    return this.cache.clear(dto.namespaces);
  }
}
