import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { APP_GUARD } from '@nestjs/core';
import { MaintenanceGuard } from './presentation/guards/maintenance.guard';
import { StaffAccessService } from './application/services/staff-access.service';
import { StaffDirectoryRepository } from './infrastructure/persistence/staff-directory.repository';
import { StaffAccessRepository } from './infrastructure/persistence/staff-access.repository';
import { RoleTemplateAdminController } from './presentation/role-template-admin.controller';
import { RoleTemplateRepository } from './infrastructure/persistence/role-template.repository';
import { RoleTemplateService } from './application/services/role-template.service';
import { MaintenanceWindowRepository } from './infrastructure/persistence/maintenance-window.repository';
import { MaintenanceWindowService } from './application/services/maintenance-window.service';
import { KeyRotationController } from './presentation/key-rotation.controller';
import { KeyRotationService } from './application/services/key-rotation.service';
import { MaintenanceController } from './presentation/maintenance.controller';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { TenancyModule } from '../tenancy/tenancy.module';
import { IamCoreModule } from './iam-core.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationModule } from '../notification/notification.module';
import { ApiKeyController } from './presentation/api-key.controller';
import { ApiKeyService } from './application/services/api-key.service';
import { ApiKeyRepository } from './infrastructure/persistence/api-key.repository';
import { OtpChallengeRepository } from './infrastructure/persistence/otp-challenge.repository';
import { SecurityAlertService } from './application/services/security-alert.service';
import { AuthController } from './presentation/auth.controller';
import { AuthService } from './application/services/auth.service';
import { AdminBootstrapService } from './application/services/admin-bootstrap.service';
import { AuthGuard } from './presentation/guards/auth.guard';
import { PermissionGuard } from './presentation/guards/permission.guard';
import { TenantActiveGuard } from './presentation/guards/tenant-active.guard';
import { RoleController } from './presentation/role.controller';
import { UserController } from './presentation/user.controller';
import { UserService } from './application/services/user.service';
import { TenantResolutionMiddleware } from './presentation/tenant-resolution.middleware';
import { OtpProvider } from './infrastructure/otp/otp-provider';
import { EmailOtpProvider } from './infrastructure/otp/email-otp.provider';
import { SmsOtpProvider } from './infrastructure/otp/sms-otp.provider';
import { OtpDeliveryRouter } from './infrastructure/otp/otp-delivery.router';

/**
 * Identity & Access Management.
 *
 * GLOBAL GUARD ORDER (Nest runs APP_GUARDs in registration order):
 *   1. AuthGuard         — establish the principal (JWT or API key)
 *   2. TenantActiveGuard — reject suspended/closed operators
 *   3. PermissionGuard   — enforce @RequirePermission
 * The rate-limit guard (from HttpModule) runs before these so abusive traffic
 * is shed before it costs us a token verification or a DB hit.
 *
 * The tenant-resolution middleware runs even earlier (before guards) so the
 * tenant is bound for RLS and logging from the very start of the request.
 */
@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    SecurityModule,
    IamCoreModule,
    TenancyModule,
    IntegrationsModule,
    NotificationModule,
    EntitlementsModule,
  ],
  controllers: [
    AuthController,
    UserController,
    RoleController,
    ApiKeyController,
    MaintenanceController,
    RoleTemplateAdminController,
    KeyRotationController,
  ],
  providers: [
    StaffDirectoryRepository,
    StaffAccessRepository,
    StaffAccessService,
    RoleTemplateRepository,
    MaintenanceWindowRepository,
    MaintenanceWindowService,
    KeyRotationService,
    RoleTemplateService,
    ApiKeyRepository,
    OtpChallengeRepository,
    ApiKeyService,
    SecurityAlertService,
    AuthService,
    AdminBootstrapService,
    UserService,
    SmsOtpProvider,
    // OTP delivery is behind an abstraction — email today, SMS later is a one-line swap.
    // Injected by type via the abstract-class token (no @Inject / Symbol).
    EmailOtpProvider,
    { provide: OtpProvider, useClass: OtpDeliveryRouter },
    AuthGuard,
    PermissionGuard,
    TenantActiveGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantActiveGuard },
    // After auth (needs the principal to let platform admins through).
    MaintenanceGuard,
    { provide: APP_GUARD, useExisting: MaintenanceGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [IamCoreModule, ApiKeyService],
})
export class IamModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*path');
  }
}
