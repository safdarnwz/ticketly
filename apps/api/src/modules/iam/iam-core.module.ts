import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { AuditService } from './application/services/audit.service';
import { AuditLogRepository } from './infrastructure/persistence/audit-log.repository';
import { RoleRepository } from './infrastructure/persistence/role.repository';
import { SessionRepository } from './infrastructure/persistence/session.repository';
import { UserRepository } from './infrastructure/persistence/user.repository';

/**
 * IAM persistence + audit, with no dependency on any feature module.
 *
 * Tenancy (operator provisioning creates the owner user and roles) needs these,
 * and IAM's guards need Tenancy — so they live in this leaf module that both
 * import, instead of being registered twice.
 */
@Module({
  imports: [DatabaseModule, CacheModule, SecurityModule],
  providers: [UserRepository, RoleRepository, SessionRepository, AuditLogRepository, AuditService],
  exports: [UserRepository, RoleRepository, SessionRepository, AuditLogRepository, AuditService],
})
export class IamCoreModule {}
