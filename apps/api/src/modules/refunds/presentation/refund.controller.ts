import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import { type BookingId } from '@kernel';

import { RefundService } from '../application/services/refund.service';
import {
  InitiateRefundSchema,
  type InitiateRefundDto,
  ReconcileRefundSchema,
  type ReconcileRefundDto,
} from './dto/refund.dto';

/**
 * Operator/finance refund endpoints. Refunds are normally initiated
 * automatically on cancellation (worker), so these are the manual + lifecycle
 * controls: kick off an ad-hoc refund, reconcile a gateway callback, retry a
 * failed one, or record a manual (off-gateway) payout.
 */
@ApiTags('refunds')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Get('bookings/:bookingId/refunds')
  @RequirePermission(Permission.PAYMENT_READ)
  @ApiOperation({ summary: 'List refunds for a booking' })
  async list(@UuidParam('bookingId') bookingId: string) {
    return { refunds: await this.refunds.listForBooking(bookingId as BookingId) };
  }

  @Post('refunds')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.PAYMENT_REFUND)
  @ApiOperation({
    summary:
      'Initiate a refund (to the original source, or an alternate bank account the customer supplies)',
  })
  async initiate(@Body(zodBody(InitiateRefundSchema)) dto: InitiateRefundDto) {
    return this.refunds.initiate({
      bookingId: dto.bookingId as BookingId,
      amountMinor: dto.amountMinor,
      destination: dto.destination,
    });
  }

  @Post('refunds/reconcile')
  @HttpCode(200)
  @RequirePermission(Permission.PAYMENT_REFUND)
  @ApiOperation({ summary: 'Reconcile a gateway refund callback' })
  async reconcile(@Body(zodBody(ReconcileRefundSchema)) dto: ReconcileRefundDto) {
    await this.refunds.reconcileGatewayEvent(dto);
    return { ok: true };
  }

  @Post('refunds/:id/retry')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.PAYMENT_REFUND)
  @ApiOperation({ summary: 'Retry a failed source refund' })
  async retry(@UuidParam('id') id: string) {
    return this.refunds.retry(id);
  }

  @Post('refunds/:id/manual')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.PAYMENT_REFUND)
  @ApiOperation({ summary: 'Mark a failed refund as paid manually (off-gateway)' })
  async manual(@UuidParam('id') id: string) {
    await this.refunds.markManual(id);
    return { ok: true };
  }
}
