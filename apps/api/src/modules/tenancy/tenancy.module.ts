import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { BookingModule } from '../booking/booking.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlanRepository } from './infrastructure/persistence/plan.repository';
import { PayoutRepository } from './infrastructure/persistence/payout.repository';
import { TenantAdminController } from './presentation/tenant-admin.controller';
import { TenantContextService } from './application/services/tenant-context.service';
import { TenantController } from './presentation/tenant.controller';
import { TenantProvisioningService } from './application/services/tenant-provisioning.service';
import { TenantRepository } from './infrastructure/persistence/tenant.repository';
// IAM providers the provisioning service depends on. Imported lazily via
// forwardRef-free ordering: TenancyModule is imported by IamModule, and the
// provisioning service's IAM deps are re-provided here so the tenancy module is
// self-contained for provisioning.
import { UserRepository } from '../iam/infrastructure/persistence/user.repository';
import { RoleRepository } from '../iam/infrastructure/persistence/role.repository';
import { AuditService } from '../iam/application/services/audit.service';

/**
 * Tenancy: operators, plans, provisioning and the runtime tenant profile.
 *
 * Note the dependency direction: IamModule imports TenancyModule (for the
 * tenant-active guard and resolution), and provisioning needs a few IAM
 * repositories. To avoid a circular module import we register those specific
 * repositories here too — they are stateless data-access classes, so having the
 * DI container construct them in this module's scope is harmless and keeps the
 * graph acyclic. BookingModule is imported directly (verified acyclic — Booking/
 * Scheduling never import Tenancy or Iam) so the platform-admin per-operator
 * stats endpoint can read `BookingRepository.statsForTenant`.
 *
 * `PlatformSettingsRepository` comes from the standalone `PlatformSettingsModule`
 * (re-exported here), NOT registered directly — PricingModule also needs it,
 * and PricingModule ← BookingModule ← TenancyModule would cycle back to
 * PricingModule if this module provided it directly and Pricing imported
 * TenancyModule to get it.
 */
@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    SecurityModule,
    BookingModule,
    PlatformSettingsModule,
    FilesModule,
  ],
  controllers: [TenantController, TenantAdminController],
  providers: [
    TenantRepository,
    PlanRepository,
    PayoutRepository,
    TenantContextService,
    TenantProvisioningService,
    UserRepository,
    RoleRepository,
    AuditService,
  ],
  exports: [
    TenantRepository,
    PlanRepository,
    PayoutRepository,
    PlatformSettingsModule,
    TenantContextService,
    TenantProvisioningService,
  ],
})
export class TenancyModule {}
