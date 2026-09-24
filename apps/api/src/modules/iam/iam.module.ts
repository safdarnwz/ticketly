import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MaintenanceGuard } from './presentation/guards/maintenance.guard';
import { StaffAccessService } from './application/services/staff-access.service';
import { MaintenanceController } from './presentation/maintenance.controller';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { TenancyModule } from '../tenancy/tenancy.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ApiKeyController } from './presentation/api-key.controller';
import { ApiKeyService } from './application/services/api-key.service';
import { AuditService } from './application/services/audit.service';
import { SecurityAlertService } from './application/services/security-alert.service';
import { AuthController } from './presentation/auth.controller';
import { AuthService } from './application/services/auth.service';
import { AdminBootstrapService } from './application/services/admin-bootstrap.service';
import { SessionRepository } from './infrastructure/persistence/session.repository';
import { AuthGuard } from './presentation/guards/auth.guard';
import { PermissionGuard } from './presentation/guards/permission.guard';
import { TenantActiveGuard } from './presentation/guards/tenant-active.guard';
import { RoleController } from './presentation/role.controller';
import { RoleRepository } from './infrastructure/persistence/role.repository';
import { UserController } from './presentation/user.controller';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { UserService } from './application/services/user.service';
import { TenantResolutionMiddleware } from './presentation/tenant-resolution.middleware';
import { Mailer } from './infrastructure/mail/mailer';
import { OtpProvider } from './infrastructure/otp/otp-provider';
import { EmailOtpProvider } from './infrastructure/otp/email-otp.provider';
import { SmsOtpProvider } from './infrastructure/otp/sms-otp.provider';

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
  imports: [DatabaseModule, CacheModule, SecurityModule, TenancyModule, IntegrationsModule],
  controllers: [AuthController, UserController, RoleController, ApiKeyController, MaintenanceController],
  providers: [
    StaffAccessService,
    UserRepository,
    RoleRepository,
    SessionRepository,
    ApiKeyService,
    AuditService,
    SecurityAlertService,
    AuthService,
    AdminBootstrapService,
    UserService,
    Mailer,
    SmsOtpProvider,
    // OTP delivery is behind an abstraction — email today, SMS later is a one-line swap.
    // Injected by type via the abstract-class token (no @Inject / Symbol).
    { provide: OtpProvider, useClass: EmailOtpProvider },
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
  exports: [UserRepository, RoleRepository, ApiKeyService, AuditService, SessionRepository, Mailer],
})
export class IamModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*path');
  }
}
