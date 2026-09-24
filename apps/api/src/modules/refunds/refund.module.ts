import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { RefundController } from './presentation/refund.controller';
import { RefundRepository } from './infrastructure/persistence/refund.repository';
import { RefundService } from './application/services/refund.service';
import { RefundCreditorRegistry } from './application/services/refund-creditor.registry';

/**
 * Refund lifecycle (Part 13). A refund is a small state machine — initiated,
 * processing, settled/failed, retried or paid manually — with refund-to-source
 * (via the PSP) and refund-to-an-alternate-bank-account (manual — see
 * RefundService's own doc comment) destinations. Every settled refund posts
 * a balanced `refund.paid` ledger entry, so the books reconcile, AND
 * publishes a `refund.settled` domain event — this is what actually drives
 * the customer's "your refund is complete" notification and the OTA partner
 * webhook (both were previously silent: nothing subscribed to a refund
 * completing because nothing ever published it).
 *
 * Depends on booking (the booking being refunded) and payment (the gateway +
 * the ledger). B2B channels (agents, GDS) register a RefundCreditor with
 * RefundCreditorRegistry so refunds of their sales credit their accounts —
 * this module never imports those channels.
 */
@Module({
  imports: [DatabaseModule, MessagingModule, BookingModule, PaymentModule],
  controllers: [RefundController],
  providers: [RefundRepository, RefundService, RefundCreditorRegistry],
  exports: [RefundService, RefundRepository, RefundCreditorRegistry],
})
export class RefundModule {}
