import { Body, Controller, Get, Post, HttpCode, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import {
  BadRequestError,
  decodeCursor,
  encodeCursor,
  getUserId,
  isUuid,
  type BookingId,
} from '@kernel';

import { RefundService } from '../application/services/refund.service';
import {
  InitiateRefundSchema,
  type InitiateRefundDto,
  ReconcileRefundSchema,
  type ReconcileRefundDto,
  MarkRefundPaidSchema,
  type MarkRefundPaidDto,
  RefundQueueSchema,
  type RefundQueueDto,
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
  @ApiOperation({
    summary: "A booking's refunds, and how much of what was paid can still be refunded",
  })
  async list(@UuidParam('bookingId') bookingId: string) {
    return this.refunds.bookingRefunds(bookingId as BookingId);
  }

  @Get('refunds')
  @RequirePermission(Permission.PAYMENT_READ)
  @ApiOperation({
    summary:
      'Refunds queue, newest first — action (failed, or a bank transfer to send), processing, done, all',
  })
  async queue(@Query(zodQuery(RefundQueueSchema)) q: RefundQueueDto) {
    let before: { createdAt: string; id: string } | undefined;
    if (q.cursor) {
      let c: ReturnType<typeof decodeCursor> | undefined;
      try {
        c = decodeCursor(q.cursor);
      } catch {
        c = undefined;
      }
      const [at, id] = c?.k ?? [];
      if (c?.v !== 1 || typeof at !== 'string' || Number.isNaN(Date.parse(at)) || !isUuid(id))
        throw new BadRequestError('That page link is no longer valid — start from the first page');
      before = { createdAt: at, id };
    }
    const [rows, needsAction] = await Promise.all([
      this.refunds.queue({ queue: q.queue, pnr: q.pnr, before, limit: q.limit + 1 }),
      this.refunds.actionCount(),
    ]);
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    return {
      items,
      needsAction,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ v: 1, k: [new Date(last.createdAt).toISOString(), last.id], d: 'desc' })
          : null,
    };
  }

  @Get('refunds/:id/payout')
  @RequirePermission(Permission.PAYMENT_REFUND)
  @ApiOperation({ summary: 'The bank account to send an alternate-account refund to' })
  async payout(@UuidParam('id') id: string) {
    return this.refunds.payoutDetails(id);
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
      altAccountDetails:
        dto.destination === 'alternate_account' ? dto.altAccountDetails : undefined,
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
  @ApiOperation({
    summary:
      'Record a refund paid outside the gateway (a failed one paid by hand, or a bank transfer sent) with its UTR',
  })
  async manual(
    @UuidParam('id') id: string,
    @Body(zodBody(MarkRefundPaidSchema)) dto: MarkRefundPaidDto,
  ) {
    await this.refunds.markManual(id, { reference: dto.reference, paidBy: getUserId() ?? null });
    return { ok: true };
  }
}
