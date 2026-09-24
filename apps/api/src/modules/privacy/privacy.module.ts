import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { PrivacyService } from './application/services/privacy.service';
import { PrivacyRepository } from './infrastructure/persistence/privacy.repository';
import { PrivacyController } from './presentation/privacy.controller';

/**
 * Privacy / DPDP (Part 15). Consent capture, right-to-be-forgotten erasure
 * (anonymise PII, keep legally-retained financials), and a callable retention
 * sweep. Consent + retention rules are pure (domain/).
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PrivacyController],
  providers: [PrivacyRepository, PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
