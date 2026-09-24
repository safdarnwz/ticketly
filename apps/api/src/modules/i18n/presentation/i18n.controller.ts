import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, RequirePlatformAdmin, zodBody } from '@http';

import { I18nService } from '../application/services/i18n.service';

const TranslationSchema = z.object({
  locale: z.string().min(2).max(10),
  key: z.string().min(1).max(160),
  value: z.string().min(1).max(4000),
});
const RateSchema = z.object({
  base: z.string().length(3),
  quote: z.string().length(3),
  rateMicros: z.number().int().positive(),
  asOf: z.string().datetime(),
});

@ApiTags('i18n')
@Controller({ path: 'i18n', version: '1' })
@ApiStandardErrors()
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  @Get('convert')
  @Public()
  @ApiOperation({ summary: 'Convert an amount (minor units) between currencies' })
  async convert(@Query('amountMinor') amountMinor: string, @Query('from') from: string, @Query('to') to: string) {
    return this.i18n.convert(Number(amountMinor), from, to);
  }

  @ApiBearerAuth('bearer')
  @Post('translations')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Create/update a translation string' })
  async upsertTranslation(@Body(zodBody(TranslationSchema)) dto: z.infer<typeof TranslationSchema>) {
    await this.i18n.upsertTranslation(dto.locale, dto.key, dto.value);
    return { ok: true };
  }

  @ApiBearerAuth('bearer')
  @Post('fx-rates')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Publish an FX rate (quote per 1 base, ×1e6)' })
  async upsertRate(@Body(zodBody(RateSchema)) dto: z.infer<typeof RateSchema>) {
    await this.i18n.upsertRate(dto.base, dto.quote, dto.rateMicros, dto.asOf);
    return { ok: true };
  }
}
