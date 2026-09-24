import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { KycController } from './presentation/kyc.controller';
import { KycRepository } from './infrastructure/persistence/kyc.repository';
import { KycService } from './application/services/kyc.service';

/**
 * KYC verification for operator onboarding — see kyc.service.ts's own doc
 * comment for the two paths (PAN format-check, DigiLocker). Platform-level:
 * operator applications have no tenant yet (the tenant is only created on
 * approval), so this module carries no RLS-scoped dependency.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [KycController],
  providers: [KycRepository, KycService],
  exports: [KycService, KycRepository],
})
export class KycModule {}
