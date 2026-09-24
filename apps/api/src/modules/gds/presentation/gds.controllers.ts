import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  RequirePermission,
  RequirePlatformAdmin,
  zodBody,
} from '@http';
import { BadRequestError, type TripId } from '@kernel';

import { TripRepository } from '../../scheduling/infrastructure/persistence/trip.repository';
import { GdsService, type PartnerCtx } from '../application/gds.service';
import { GdsPartnerGuard } from './gds-partner.guard';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/);
const SearchSchema = z.object({
  originCityId: uuid,
  destCityId: uuid,
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const BlockSchema = z.object({
  tripId: uuid,
  fromStopId: uuid,
  toStopId: uuid,
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(6),
  passengers: z
    .array(
      z.object({
        seatNumber: z.string().trim().min(1),
        fullName: z.string().trim().min(2).max(120),
        age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(['male', 'female', 'other']).optional(),
      }),
    )
    .min(1)
    .max(6),
  contactPhone: phone,
  contactEmail: z.string().trim().email().optional(),
});
const CancelSchema = z.object({
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(6).optional(),
  reason: z.string().trim().max(300).optional(),
});

type PartnerReq = { gds: PartnerCtx };

/**
 * PUBLIC GDS PARTNER API — the single integration an OTA (redBus, AbhiBus,
 * Paytm, …) or a multi-operator agent builds to sell EVERY participating
 * operator. Auth: `X-GDS-Key`. Writes are idempotent (Idempotency-Key header).
 */
@ApiTags('gds-partner-api')
@ApiHeader({
  name: 'X-GDS-Key',
  required: true,
  description: 'Partner API key (gds_live_… or gds_test_…)',
})
@Controller({ path: 'gds', version: '1' })
@ApiStandardErrors()
@Public()
@UseGuards(GdsPartnerGuard)
export class GdsPartnerController {
  constructor(private readonly gds: GdsService) {}

  @Get('account')
  @ApiOperation({ summary: 'Your balance, credit limit, spendable amount and recent ledger' })
  account(@Req() req: PartnerReq) {
    return this.gds.account(req.gds);
  }

  @Post('search')
  @HttpCode(200)
  @RateLimit(600, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Search trips across all operators distributing to you (with your commission % per operator)',
  })
  search(@Req() req: PartnerReq, @Body(zodBody(SearchSchema)) dto: z.infer<typeof SearchSchema>) {
    return this.gds.searchTrips(req.gds, dto);
  }

  @Get('trips/:tripId/seats')
  @RateLimit(600, 60_000, 'ip')
  @ApiOperation({ summary: 'Live seat map for a segment' })
  seats(
    @Req() req: PartnerReq,
    @Param('tripId') tripId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to)
      throw new BadRequestError('Query parameters "from" and "to" (stop ids) are required');
    return this.gds.seats(req.gds, tripId, from, to);
  }

  @Post('bookings')
  @HttpCode(201)
  @Idempotent()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: 'Block seats (tentative). Confirm before holdExpiresAt.' })
  block(@Req() req: PartnerReq, @Body(zodBody(BlockSchema)) dto: z.infer<typeof BlockSchema>) {
    return this.gds.block(req.gds, dto);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @Idempotent()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Confirm: debits your GDS account (ticket value minus your commission) and issues tickets. 402 if balance/credit is short.',
  })
  confirm(@Req() req: PartnerReq, @Param('id') id: string) {
    return this.gds.confirm(req.gds, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary:
      "Cancel all or some seats of your booking (operator's cancellation policy); refund credited to your account",
  })
  cancel(
    @Req() req: PartnerReq,
    @Param('id') id: string,
    @Body(zodBody(CancelSchema)) dto: z.infer<typeof CancelSchema>,
  ) {
    return this.gds.cancel(req.gds, id, dto);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Booking, passengers and tickets (your bookings only)' })
  booking(@Req() req: PartnerReq, @Param('id') id: string) {
    return this.gds.bookingDetail(req.gds, id);
  }
}

const CreatePartnerSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['ota', 'agent']).default('ota'),
  billingMode: z.enum(['prepaid', 'postpaid']),
  creditLimitMinor: z.number().int().nonnegative().default(0),
  defaultCommissionPct: z.number().min(0).max(30).default(8),
  contactEmail: z.string().email().optional(),
  contactPhone: phone.optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional(),
  webhookUrl: z.string().url().startsWith('https://').optional(),
});
const KeySchema = z.object({
  label: z.string().trim().min(2).max(60),
  sandbox: z.boolean().default(false),
  ipAllowlist: z
    .array(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/))
    .max(20)
    .default([]),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/** PLATFORM ADMIN: onboard OTAs / multi-operator agents, credit terms, receipts, API keys. */
@ApiTags('admin-gds')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/gds/partners', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class GdsAdminController {
  constructor(private readonly gds: GdsService) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body(zodBody(CreatePartnerSchema)) dto: z.infer<typeof CreatePartnerSchema>) {
    return { id: await this.gds.createPartner(dto) };
  }
  @Get() async list(@Query('status') status?: string) {
    return { items: await this.gds.listPartners(status) };
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.gds.partnerDetail(id);
  }
  @Post(':id/status')
  @HttpCode(200)
  async status(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          status: z.enum(['active', 'suspended']),
          reason: z.string().trim().max(300).optional(),
        }),
      ),
    )
    dto: { status: 'active' | 'suspended'; reason?: string },
  ) {
    await this.gds.setStatus(id, dto.status, dto.reason);
    return { ok: true };
  }
  @Put(':id/terms')
  async terms(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          billingMode: z.enum(['prepaid', 'postpaid']).optional(),
          creditLimitMinor: z.number().int().nonnegative().optional(),
          defaultCommissionPct: z.number().min(0).max(30).optional(),
          webhookUrl: z.string().url().startsWith('https://').optional(),
        }),
      ),
    )
    dto: {
      billingMode?: 'prepaid' | 'postpaid';
      creditLimitMinor?: number;
      defaultCommissionPct?: number;
      webhookUrl?: string;
    },
  ) {
    await this.gds.setTerms(id, dto);
    return { ok: true };
  }
  @Post(':id/receipts')
  @HttpCode(200)
  @Idempotent()
  receipt(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          amountMinor: z.number().int().positive(),
          reference: z.string().trim().min(3).max(60),
        }),
      ),
    )
    dto: { amountMinor: number; reference: string },
  ) {
    return this.gds.receipt(id, dto.amountMinor, dto.reference);
  }
  @Post(':id/keys')
  @HttpCode(201)
  @ApiOperation({ summary: 'Issue an API key (returned ONCE). Sandbox keys are read-only.' })
  issueKey(@Param('id') id: string, @Body(zodBody(KeySchema)) dto: z.infer<typeof KeySchema>) {
    return this.gds.issueKey(id, dto);
  }
  @Delete(':id/keys/:keyId')
  async revoke(@Param('id') id: string, @Param('keyId') keyId: string) {
    await this.gds.revokeKey(id, keyId);
    return { ok: true };
  }
}

/** OPERATOR: choose which GDS partners may sell your seats and at what commission; channel-wise sales per trip. */
@ApiTags('gds-operator')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class GdsOperatorController {
  constructor(
    private readonly gds: GdsService,
    private readonly trips: TripRepository,
  ) {}

  @Get('gds-partners')
  @RequirePermission(Permission.TENANT_MANAGE)
  async partners() {
    return { items: await this.gds.partnersForOperator() };
  }

  @Put('gds-partners/:partnerId')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary: 'Start / pause distributing to a partner and set the commission you give it (0–30%)',
  })
  async agreement(
    @Param('partnerId') partnerId: string,
    @Body(
      zodBody(
        z.object({
          status: z.enum(['active', 'paused']),
          commissionPct: z.number().min(0).max(30),
        }),
      ),
    )
    dto: { status: 'active' | 'paused'; commissionPct: number },
  ) {
    await this.gds.setAgreement(partnerId, dto.status, dto.commissionPct);
    return { ok: true };
  }

  @Put('trips/:tripId/closed-channels')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({
    summary:
      'Channel-wise sales control for one trip (e.g. ["ota"] stops partner sales, web keeps selling)',
  })
  async channels(
    @Param('tripId') tripId: string,
    @Body(
      zodBody(
        z.object({ closed: z.array(z.enum(['direct_web', 'agent', 'ota', 'phone'])).max(4) }),
      ),
    )
    dto: { closed: string[] },
  ) {
    await this.trips.getById(tripId as TripId);
    await this.trips.setClosedChannels(tripId as TripId, dto.closed);
    return { ok: true, closed: [...new Set(dto.closed)] };
  }
}
