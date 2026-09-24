import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { IntegrationCredentialStore } from './infrastructure/integration-credential.store';

/**
 * Platform integration credentials. Standalone (database + security only) so
 * IAM (Mailer), notifications (SMS/WhatsApp) and payments (Razorpay) can all
 * import it without creating a module cycle.
 */
@Module({
  imports: [DatabaseModule, SecurityModule],
  providers: [IntegrationCredentialStore],
  exports: [IntegrationCredentialStore],
})
export class IntegrationsModule {}
