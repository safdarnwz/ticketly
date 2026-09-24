import { Body, Controller, Delete, Get, Header, Param, Put, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, RequirePlatformAdmin, zodBody } from '@http';

import { AppearanceService } from '../application/services/appearance.service';
import type { ThemePatch } from '../domain/theme';

// A permissive schema: any subset of the token tree. Values are validated
// against the token rules in the service (validateTheme) before persisting.
const ThemePatchSchema = z.record(z.any());

@ApiTags('appearance')
@ApiBearerAuth('bearer')
@Controller({ path: 'appearance', version: '1' })
@ApiStandardErrors()
export class AppearanceController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Effective theme for a role (default ← role)' })
  async theme(@Query('role') role?: string) {
    return { theme: await this.appearance.effectiveTheme(role) };
  }

  @Get('css')
  @Public()
  @Header('Content-Type', 'text/css; charset=utf-8')
  @ApiOperation({ summary: 'Effective theme as an injectable :root stylesheet' })
  async css(@Query('role') role?: string) {
    return this.appearance.css(role);
  }

  @Get('admin/overview')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Baseline default + all stored overrides (admin editor)' })
  async overview() {
    return this.appearance.overview();
  }

  @Put('platform')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Save the platform-wide default theme override' })
  async savePlatformDefault(@Body(zodBody(ThemePatchSchema)) patch: ThemePatch) {
    return { theme: await this.appearance.savePatch('', patch) };
  }

  @Put('role/:role')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Save a per-role theme override' })
  async saveRole(@Param('role') role: string, @Body(zodBody(ThemePatchSchema)) patch: ThemePatch) {
    return { theme: await this.appearance.savePatch(role, patch) };
  }

  @Delete('role/:role')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Reset a per-role override to the platform default theme' })
  async resetRole(@Param('role') role: string) {
    await this.appearance.reset(role);
    return { ok: true };
  }
}
