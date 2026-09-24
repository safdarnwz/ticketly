import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Public,
  RequirePermission,
  RequirePlatformAdmin,
  zodBody,
  zodQuery,
} from '@http';

import { I18nService } from '../application/services/i18n.service';
import {
  TranslationSchema,
  ExchangeRateSchema,
  ConvertQuerySchema,
  type TranslationDto,
  type ExchangeRateDto,
  type ConvertQueryDto,
} from './dto/i18n.dto';

@ApiTags('i18n')
@Controller({ path: 'i18n', version: '1' })
@ApiStandardErrors()
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  @Get('convert')
  @Public()
  @ApiOperation({ summary: 'Convert an amount (minor units) between currencies' })
  async convert(@Query(zodQuery(ConvertQuerySchema)) query: ConvertQueryDto) {
    return this.i18n.convert(query.amountMinor, query.from, query.to);
  }

  @ApiBearerAuth('bearer')
  @Post('translations')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Create/update a translation string' })
  async upsertTranslation(@Body(zodBody(TranslationSchema)) dto: TranslationDto) {
    await this.i18n.upsertTranslation(dto.locale, dto.key, dto.value);
    return { ok: true };
  }

  @ApiBearerAuth('bearer')
  @Post('fx-rates')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Publish an FX rate (quote per 1 base, ×1e6)' })
  async upsertRate(@Body(zodBody(ExchangeRateSchema)) dto: ExchangeRateDto) {
    await this.i18n.upsertRate(dto.base, dto.quote, dto.rateMicros, dto.asOf);
    return { ok: true };
  }
}
