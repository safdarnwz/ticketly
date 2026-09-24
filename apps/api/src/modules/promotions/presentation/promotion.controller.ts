import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardErrors,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
} from '@http';
import { getContext } from '@kernel';

import { Permission } from '@contracts';
import { PromotionService } from '../application/services/promotion.service';
import {
  SetPromotionRateSchema,
  type SetPromotionRateDto,
  PurchasePromotionSchema,
  type PurchasePromotionDto,
} from './dto/promotion.dto';

@ApiTags('promotions')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class PromotionController {
  constructor(private readonly promotions: PromotionService) {}

  // ── Super-admin: rate card ────────────────────────────────────────────
  @Get('admin/promotions/rates')
  @RequirePlatformAdmin()
  @ApiOperation({
    summary:
      'Current platform-wide route-promotion rate card (daily/weekly/monthly x single/multi-route)',
  })
  async rates() {
    return { rates: await this.promotions.currentRates() };
  }

  @Post('admin/promotions/rates')
  @RequirePlatformAdmin()
  @ApiOperation({
    summary:
      'Set (supersede) the rate for one billing-cycle/bundle-type combination — takes effect for new purchases only, never retroactively',
  })
  async setRate(@Body(zodBody(SetPromotionRateSchema)) dto: SetPromotionRateDto) {
    const ctx = getContext();
    await this.promotions.setRate(dto, ctx?.userId ?? null);
    return { ok: true };
  }

  // ── Operator: purchase & manage ─────────────────────────────────────────
  @Get('promotions/rates')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({
    summary:
      'Read-only view of the current platform-wide rate card, for an operator deciding whether to purchase a promotion (setting the rate is platform-admin-only; see admin/promotions/rates)',
  })
  async ratesView() {
    return { rates: await this.promotions.currentRates() };
  }

  @Post('promotions')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({
    summary:
      'Promote one or more routes — 2+ routes in one purchase get the multi-route rate. Bubbles into the top of search results ("Prio" badge) for the purchase window.',
  })
  async purchase(@Body(zodBody(PurchasePromotionSchema)) dto: PurchasePromotionDto) {
    return this.promotions.purchase(dto as never);
  }

  @Get('promotions')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({ summary: "This operator's own promotions" })
  async list() {
    return { promotions: await this.promotions.list() };
  }

  @Delete('promotions/:id')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({
    summary:
      "Cancel an active promotion — today is charged in full; unused full days after today reduce what's owed (adjusted directly if not yet settled, or credited against the NEXT settlement if it already was). Not a customer-style refund — no separate payment is ever reversed.",
  })
  async cancel(@UuidParam('id') id: string) {
    return this.promotions.cancel(id);
  }

  @Post('promotions/:id/pause')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({
    summary:
      'Opt out temporarily — stops search visibility with NO refund, but no days are lost either (resume() extends the end date by however long it was paused)',
  })
  async pause(@UuidParam('id') id: string) {
    return this.promotions.pause(id);
  }

  @Post('promotions/:id/resume')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({
    summary:
      'Opt back in — resumes a paused promotion, extending its end date by the paused duration so the full paid-for day-count is always eventually shown',
  })
  async resume(@UuidParam('id') id: string) {
    return this.promotions.resume(id);
  }
}
