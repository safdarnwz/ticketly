import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { FraudController } from './presentation/fraud.controller';
import { FraudRepository } from './infrastructure/persistence/fraud.repository';
import { FraudService } from './application/services/fraud.service';

/**
 * Fraud/risk (Part 14). Transparent, rule-weighted booking risk scoring with an
 * audit trail and a manual-review queue. The scoring is a pure function
 * (domain/risk-scorer.ts) so every point is attributable and tunable.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [FraudController],
  providers: [FraudRepository, FraudService],
  exports: [FraudService],
})
export class FraudModule {}
