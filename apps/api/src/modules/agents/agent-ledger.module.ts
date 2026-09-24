import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { AgentRefundService } from './application/services/agent-refund.service';
import { AgentRepository } from './infrastructure/persistence/agent.repository';

/** The agent account ledger on its own — importable by refunds without cycles. */
@Module({
  imports: [DatabaseModule],
  providers: [AgentRepository, AgentRefundService],
  exports: [AgentRepository, AgentRefundService],
})
export class AgentLedgerModule {}
