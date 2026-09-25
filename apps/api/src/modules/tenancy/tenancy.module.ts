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
import { TenantRateLimitService } from './application/services/tenant-rate-limit.service';
import { TenantBrandingService } from './application/services/tenant-branding.service';
import { TenantContextService } from './application/services/tenant-context.service';
import { TenantController } from './presentation/tenant.controller';
import { TenantProvisioningService } from './application/services/tenant-provisioning.service';
import { TenantRepository } from './infrastructure/persistence/tenant.repository';
import { IamCoreModule } from '../iam/iam-core.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * Tenancy: operators, plans, provisioning and the runtime tenant profile.
 *
 * IAM persistence (users, roles, audit) comes from the leaf `IamCoreModule`,
 * which IamModule also imports — so neither module registers the other's
 * repositories and the graph stays acyclic. BookingModule is imported directly (verified acyclic — Booking/
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
    IamCoreModule,
    BookingModule,
    PlatformSettingsModule,
    FilesModule,
    NotificationModule,
  ],
  controllers: [TenantController, TenantAdminController],
  providers: [
    TenantRepository,
    PlanRepository,
    PayoutRepository,
    TenantContextService,
    TenantBrandingService,
    TenantRateLimitService,
    TenantProvisioningService,
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
