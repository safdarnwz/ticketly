import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { AmendmentsModule } from '../amendments/amendments.module';
import { BookingModule } from '../booking/booking.module';
import { IamModule } from '../iam/iam.module';
import { PaymentModule } from '../payment/payment.module';
import { QuotasModule } from '../quotas/quotas.module';
import { AgentLedgerModule } from './agent-ledger.module';
import { AgentService } from './application/services/agent.service';
import { AgentPortalController } from './presentation/agent-portal.controller';
import { AgentController } from './presentation/agent.controller';

/** B2B agent network: operator console (/agents) + agent self-service (/agent-portal). */
@Module({
  imports: [DatabaseModule, MessagingModule, BookingModule, PaymentModule, IamModule, AgentLedgerModule, QuotasModule, AmendmentsModule],
  controllers: [AgentController, AgentPortalController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentsModule {}
