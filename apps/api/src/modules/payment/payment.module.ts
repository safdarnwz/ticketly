import { Module } from '@nestjs/common';

import { AppConfig, ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { BookingModule } from '../booking/booking.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PricingModule } from '../pricing/pricing.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { IntegrationCredentialStore } from '../integrations';
import { MockGateway } from './infrastructure/gateways/mock.gateway';
import { RazorpayGateway } from './infrastructure/gateways/razorpay.gateway';
import { TestGateway } from './infrastructure/gateways/test.gateway';
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
    // Priority: real Razorpay (once keys are set) → sandbox TestGateway
    // (while PAYMENT_TEST_MODE is on) → reference MockGateway. Flipping to
    // production is purely an env-var change — RAZORPAY_KEY_ID present wins
    // regardless of PAYMENT_TEST_MODE, so you don't have to remember to also
    // flip that flag off. Razorpay saved + enabled under Admin → Integrations
    // counts the same as the env keys; that choice is made at process start.
    {
      provide: PaymentGateway,
      useFactory: async (
        config: AppConfig,
        razorpay: RazorpayGateway,
        credentials: IntegrationCredentialStore,
      ) => {
        await credentials.ready();
        const razorpayOn =
          config.payment.razorpay.enabled || credentials.active('razorpay') !== null;
        return razorpayOn
          ? razorpay
          : config.payment.testMode
            ? new TestGateway(config)
            : new MockGateway(config);
      },
      inject: [AppConfig, RazorpayGateway, IntegrationCredentialStore],
    },
  ],
  exports: [LedgerRepository, PaymentRepository, PaymentService, SettlementService, PaymentGateway],
})
export class PaymentModule {}
