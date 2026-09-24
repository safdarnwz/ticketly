import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { BookingModule } from '../booking/booking.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PricingModule } from '../pricing/pricing.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RazorpayGateway } from './infrastructure/gateways/razorpay.gateway';
import { ConfiguredPaymentGateway } from './infrastructure/gateways/configured.gateway';
import { PaymentGateway } from './infrastructure/gateways/gateway.interface';
import { LedgerRepository } from './infrastructure/persistence/ledger.repository';
import { PaymentController } from './presentation/payment.controller';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentService } from './application/services/payment.service';
import { SettlementService } from './application/services/settlement.service';

/**
 * Payments, ledger & settlement. The gateway is bound behind the
 * PaymentGateway token so swapping/adding a PSP is a one-line provider change.
 * Depends on booking (to confirm on capture).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    BookingModule,
    SchedulingModule,
    PricingModule,
    MasterDataModule,
    PlatformSettingsModule,
    IntegrationsModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentRepository,
    LedgerRepository,
    PaymentService,
    SettlementService,
    RazorpayGateway,
    // Picks Razorpay / sandbox / mock on every call — see ConfiguredPaymentGateway.
    ConfiguredPaymentGateway,
    { provide: PaymentGateway, useExisting: ConfiguredPaymentGateway },
  ],
  exports: [LedgerRepository, PaymentRepository, PaymentService, SettlementService, PaymentGateway],
})
export class PaymentModule {}
