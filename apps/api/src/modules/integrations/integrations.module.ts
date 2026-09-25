import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { IntegrationAdminService } from './application/integration-admin.service';
import { IntegrationTesterRegistry } from './application/integration-tester.registry';
import { IntegrationCredentialStore } from './infrastructure/integration-credential.store';
import { IntegrationAdminController } from './presentation/integration-admin.controller';

/**
 * Platform integration credentials. Standalone (database + security only) so
 * IAM (Mailer), notifications (SMS/WhatsApp) and payments (Razorpay) can all
 * import it without creating a module cycle.
 */
@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [IntegrationAdminController],
  providers: [IntegrationCredentialStore, IntegrationTesterRegistry, IntegrationAdminService],
  exports: [IntegrationCredentialStore, IntegrationTesterRegistry],
})
export class IntegrationsModule {}
