import { Body, Controller, Get, Headers, Param, Post, Req, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AppConfig } from '@config';
import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, Public, RateLimit, RequirePermission, RequirePlatformAdmin, zodBody } from '@http';
import { localDate, type BookingId } from '@kernel';

import {
  ChargeTestSchema, type ChargeTestDto,
  CreateIntentSchema, type CreateIntentDto,
  GenerateSettlementSchema, type GenerateSettlementDto,
} from './dto/payment.dto';
import { TEST_PAYMENT_METHODS } from '../domain/test-gateway';
import { LedgerRepository } from '../infrastructure/persistence/ledger.repository';
import { PaymentService } from '../application/services/payment.service';
import { PaymentRepository } from '../infrastructure/persistence/payment.repository';
import { SettlementService } from '../application/services/settlement.service';

@ApiTags('payments')
@Controller({ path: 'payments', version: '1' })
@ApiStandardErrors()
export class PaymentController {
  constructor(
    private readonly payment: PaymentService,
    private readonly settlement: SettlementService,
    private readonly ledger: LedgerRepository,
    private readonly payments: PaymentRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * TEST/SANDBOX only. Advertise the available test payment methods, the banks
   * offered for net-banking, and (in test mode) the exact credentials that
   * succeed — so the checkout UI can show them as hints. Public: no auth needed
   * just to render the payment form. Remove with the sandbox.
   */
  @Public()
  @Get('test-methods')
  @ApiOperation({ summary: 'List sandbox payment methods (test mode only)' })
  testMethods() {
    const t = this.config.payment.test;
    const enabled = this.config.payment.testMode;
    return {
      testMode: enabled,
      methods: TEST_PAYMENT_METHODS,
      banks: t.netbankingBanks,
      // Hints are only meaningful in a sandbox; never emit real secrets here.
      hints: enabled
        ? {
            upi: t.upiSuccessVpa,
            upiFailure: t.upiFailureVpa,
            card: t.cardSuccessNumber,
            cardExpiry: t.cardExpiry,
            cardCvv: t.cardCvv,
            netbankingUser: t.netbankingUser,
            netbankingPassword: t.netbankingPassword,
          }
        : null,
    };
  }

  /**
   * TEST/SANDBOX charge. Validate the submitted test credentials and, on
   * success, confirm the booking + post the ledger (a real capture). Requires
   * the same permission as creating a booking. Remove with the sandbox.
   */
  @Public()
  @Post('charge')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({ summary: 'Charge a held booking via the sandbox gateway (test mode)' })
  async charge(@Body(zodBody(ChargeTestSchema)) dto: ChargeTestDto) {
    const { bookingId, ...instrument } = dto;
    return this.payment.chargeTest(bookingId as BookingId, instrument);
  }

  @Post('upgrade-seat')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Upgrade a ticket to a different seat (e.g. seater→sleeper) before the 1hr-before-departure cutoff — charges only the fare differential + its own GST' })
  async upgradeSeat(@Body() dto: { ticketId: string; toSeatNumber: string }) {
    return this.payment.upgradeSeat(dto.ticketId, dto.toSeatNumber);
  }

  @Post('intent')
  @HttpCode(201)
  @Public()
  @Idempotent()
  @ApiOperation({ summary: 'Create a payment intent for a held booking (guest checkout, same as hold/confirm)' })
  async createIntent(@Body(zodBody(CreateIntentSchema)) dto: CreateIntentDto) {
    return this.payment.createIntent(dto.bookingId as BookingId);
  }

  @Post('verify')
  @HttpCode(200)
  @Public()
  @Idempotent()
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({ summary: "Verify the gateway's client-side checkout callback and confirm the booking immediately (webhook still runs too)" })
  async verify(@Body() dto: { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const { bookingId, ...callback } = dto;
    return this.payment.verifyAndCapture(bookingId as BookingId, callback);
  }

  /**
   * PSP webhook. `@Public()` — the PSP is not an authenticated user; the
   * signature IS the authentication. The raw body is required for signature
   * verification, so this reads `request.rawBody` (Fastify preserves it).
   */
  @Public()
  @Post('webhook/:gateway')
  @HttpCode(200)
  @ApiOperation({ summary: 'Payment gateway webhook (signature-verified)' })
  async webhook(@Req() request: FastifyRequest, @Headers() headers: Record<string, string>) {
    const raw = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    return this.payment.handleWebhook(raw, headers);
  }

  // NOTE: commission used to be settable HERE by the operator on themselves
  // (POST /payments/commission, tenant-scoped permission) — exactly backwards,
  // since commission is the PLATFORM's revenue on this operator's bookings.
  // Replaced with the two platform-admin-only endpoints below: only a
  // genuinely tenant-less super-admin principal (@RequirePlatformAdmin) can
  // set what ANOTHER tenant pays — a tenant owner's own `*` permission does
  // NOT satisfy this, by design (see PermissionGuard).

  @Get('admin/commission/:tenantId')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "An operator's platform commission override (null = using the platform default)" })
  async getCommission(@Param('tenantId') tenantId: string) {
    return { override: await this.payments.getCommissionForTenant(tenantId) };
  }

  @Post('admin/commission')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Set an operator's negotiated platform commission (overrides the global default)" })
  async setCommission(@Body() dto: { tenantId: string; model: 'percent' | 'flat' | 'percent_plus'; percent?: number; flatMinor?: number; capMinor?: number }) {
    await this.payments.setCommissionForTenant(dto.tenantId, dto);
    return { ok: true };
  }

  @Get('ledger/trial-balance')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Trial balance (grand total must be zero)' })
  async trialBalance() {
    const accounts = await this.ledger.trialBalance();
    const total = accounts.reduce((s, a) => s + Number(a.balance), 0);
    return { accounts, total, balanced: total === 0 };
  }

  @Post('settlements')
  @HttpCode(201)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Generate a settlement for a period' })
  async generateSettlement(@Body(zodBody(GenerateSettlementSchema)) dto: GenerateSettlementDto) {
    return this.settlement.generate(localDate(dto.periodFrom), localDate(dto.periodTo));
  }

  @Post('settlements/:id/finalise')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Finalise & pay a settlement' })
  async finaliseSettlement(@Param('id') id: string) {
    await this.settlement.finalise(id);
    return { ok: true };
  }
}
