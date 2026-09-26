import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../entitlements/entitlements.module';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { AmendmentsModule } from '../amendments/amendments.module';
import { BookingModule } from '../booking/booking.module';
import { BranchesModule } from '../branches/branches.module';
import { IamModule } from '../iam/iam.module';
import { PaymentModule } from '../payment/payment.module';
import { QuotasModule } from '../quotas/quotas.module';
import { RefundModule } from '../refunds/refund.module';
import { AgentRepository } from './infrastructure/persistence/agent.repository';
import { AgentRefundService } from './application/services/agent-refund.service';
import { AgentService } from './application/services/agent.service';
import { AgentPortalController } from './presentation/agent-portal.controller';
import { AgentController } from './presentation/agent.controller';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

/** B2B agent network: operator console (/agents) + agent self-service (/agent-portal). */
@Module({
  imports: [
    DatabaseModule,
    MessagingModule,
    BookingModule,
    PaymentModule,
    IamModule,
    BranchesModule,
    RefundModule,
    QuotasModule,
    AmendmentsModule,
    PlatformSettingsModule,
    EntitlementsModule,
  ],
  controllers: [AgentController, AgentPortalController],
  providers: [AgentService, AgentRepository, AgentRefundService],
  exports: [AgentService],
})
export class AgentsModule {}
