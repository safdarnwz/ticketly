import { z } from 'zod';
import { NotFoundError } from '@kernel';
import { BookingRepository } from '../../booking/infrastructure/persistence/booking.repository';
import { Body, Controller, Delete, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiSecurity, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RateLimit, RequirePermission, zodBody } from '@http';
import {
  getContext,
  getUserId,
  localDate,
  type BookingId,
  type CityId,
  type StopId,
  type TripId,
} from '@kernel';

import { BookingService } from '../../booking/application/services/booking.service';
import { PaymentService } from '../../payment/application/services/payment.service';
import { PricingService } from '../../pricing/application/services/pricing.service';
import { SearchService } from '../../search/application/services/search.service';
import { HoldSchema, type HoldDto } from '../../booking/presentation/dto/booking.dto';
import {
  QuoteSchema,
  type QuoteDto,
  SearchSchema,
  type SearchDto,
} from '../../pricing/presentation/dto/pricing.dto';
import { WebhookRepository } from '../infrastructure/webhook.repository';

/**
 * ============================================================================
 *  OTA / channel-partner distribution API
 * ============================================================================
 *
 * The redBus/Paytm-style integration surface. A partner authenticates with an
 * **API key** (Part 2 — `X-Api-Key`), whose scopes gate access; the auth guard
 * resolves the tenant from the key, so a partner is always scoped to the one
 * operator that issued its key.
 *
 * DESIGN: this controller is a THIN adapter over the exact same internal
 * services the first-party storefront uses (`SearchService`, `PricingService`,
 * `BookingService`). Partners therefore get identical inventory, pricing and the
 * same anti-double-sell guarantees — there is no separate, drifting "partner"
 * code path. Booking endpoints are `@Idempotent()` because partners retry
 * aggressively, and rate-limited per key.
 *
 * The generated OpenAPI spec (served at `/docs-json`) IS the partner
 * integration contract; the event catalogue in `@messaging` is the webhook
 * contract.
 */
const PartnerConfirmSchema = z.object({
  bookingId: z.string().uuid(),
  paidMinor: z.number().int().positive(),
  reference: z.string().trim().max(100).optional(),
});
type PartnerConfirmDto = z.infer<typeof PartnerConfirmSchema>;
const PartnerCancelSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().trim().max(300).optional(),
});
type PartnerCancelDto = z.infer<typeof PartnerCancelSchema>;

@ApiTags('distribution')
@ApiSecurity('apiKey')
@Controller({ path: 'distribution', version: '1' })
@ApiStandardErrors()
export class DistributionController {
  constructor(
    private readonly search: SearchService,
    private readonly pricing: PricingService,
    private readonly booking: BookingService,
    private readonly payment: PaymentService,
    private readonly webhooks: WebhookRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  @Post('search')
  @HttpCode(200)
  @RateLimit(300, 60_000, 'tenant')
  @ApiOperation({ summary: 'Search inventory (partner)' })
  async search_(@Body(zodBody(SearchSchema)) dto: SearchDto) {
    const results = await this.search.search({
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: localDate(dto.journeyDate),
      seatType: dto.seatType,
      fromStopId: dto.fromStopId as StopId | undefined,
      toStopId: dto.toStopId as StopId | undefined,
    });
    return { count: results.length, results };
  }

  @Post('quote')
  @HttpCode(200)
  @RateLimit(300, 60_000, 'tenant')
  @ApiOperation({ summary: 'Price quote (partner)' })
  async quote(@Body(zodBody(QuoteSchema)) dto: QuoteDto) {
    return this.pricing.quote({
      tripId: dto.tripId as TripId,
      fromStopId: dto.fromStopId as StopId,
      toStopId: dto.toStopId as StopId,
      seatType: dto.seatType,
      seatNumbers: dto.seatNumbers,
      seatCount: dto.seatCount,
      couponCode: dto.couponCode,
    });
  }

  @Post('bookings/hold')
  @HttpCode(201)
  @Idempotent()
  @RateLimit(120, 60_000, 'tenant')
  @ApiOperation({ summary: 'Hold seats (partner)' })
  async hold(@Body(zodBody(HoldSchema)) dto: HoldDto) {
    // Force the OTA channel regardless of what the partner sends.
    return this.booking.hold({ ...dto, channel: 'ota' });
  }

  @Post('bookings/confirm')
  @HttpCode(200)
  @Idempotent()
  @RateLimit(120, 60_000, 'tenant')
  @ApiOperation({
    summary:
      'Confirm a held booking after partner-side payment (posts commission/payable/tax to the ledger identically to a direct online payment)',
  })
  async confirm(@Body(zodBody(PartnerConfirmSchema)) body: PartnerConfirmDto) {
    await this.assertPartnerBooking(body.bookingId as BookingId);
    return this.payment.confirmPartnerBooking(
      body.bookingId as BookingId,
      body.paidMinor,
      body.reference,
    );
  }

  @Post('bookings/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({ summary: 'Cancel a booking (partner)' })
  async cancel(@Body(zodBody(PartnerCancelSchema)) body: PartnerCancelDto) {
    await this.assertPartnerBooking(body.bookingId as BookingId);
    return this.booking.cancel(body.bookingId as BookingId, body.reason);
  }

  /**
   * A partner key may only confirm/cancel bookings made THROUGH the partner
   * channel — never the operator's direct-web or agent bookings (before this
   * check, any partner key could cancel any customer's booking). Same 404 for
   * "not yours" and "doesn't exist".
   */
  private async assertPartnerBooking(bookingId: BookingId): Promise<void> {
    const channel = await this.bookingRepo.channelOf(bookingId);
    if (channel !== 'ota') throw new NotFoundError('Booking', bookingId);
  }

  @Get('webhooks/catalogue')
  @ApiOperation({ summary: 'The events a partner can subscribe to' })
  catalogue() {
    // The public webhook contract — kept in sync with @messaging EventType.
    return {
      events: [
        'booking.confirmed',
        'booking.cancelled',
        'trip.delayed',
        'trip.departed',
        'payment.captured',
        'refund.settled',
      ],
      note: 'Webhooks are signed: header `X-Ticketly-Signature: sha256=<hex>`, hex = HMAC_SHA256(your webhook secret, the raw JSON body). Verify before trusting.',
      partner: getContext()?.extra?.partnerName ?? null,
    };
  }

  /* ── Webhook MANAGEMENT — the OPERATOR configures these (their own staff
     JWT + permission, not a partner's API key) — deciding which partner
     integration gets which events, and to which URL. ────────────────────── */

  @Post('webhooks')
  @HttpCode(201)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Register a partner webhook (returns the signing secret ONCE)' })
  async registerWebhook(@Body() dto: { name: string; url: string; eventTypes?: string[] }) {
    return this.webhooks.register({
      name: dto.name,
      url: dto.url,
      eventTypes: dto.eventTypes ?? [],
      createdBy: getUserId() ?? null,
    });
  }

  @Get('webhooks')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: "List this operator's registered partner webhooks" })
  async listWebhooks() {
    return { items: await this.webhooks.list() };
  }

  @Get('webhooks/:id/deliveries')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary: 'Recent delivery attempts for a webhook (debugging a partner integration)',
  })
  async webhookDeliveries(@Param('id') id: string) {
    return { items: await this.webhooks.recentDeliveries(id) };
  }

  @Delete('webhooks/:id')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Revoke a partner webhook' })
  async revokeWebhook(@Param('id') id: string) {
    await this.webhooks.revoke(id);
    return { ok: true };
  }
}
