import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';

import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { IamModule } from '../iam/iam.module';
import { NotificationModule } from '../notification/notification.module';
import { OnboardingService } from './application/services/onboarding.service';
import { OperatorApplicationRepository } from './infrastructure/persistence/operator-application.repository';
import { OnboardingController } from './presentation/onboarding.controller';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

/**
 * Operator onboarding: the public "Become an Operator" application + the
 * super/platform-admin review that provisions a tenant + operator-admin on
 * approval. Reuses IAM's user repository + mailer; the review state machine is
 * pure (domain/application-status.ts).
 */
@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    IamModule,
    NotificationModule,
    FilesModule,
    PlatformSettingsModule,
  ],
  controllers: [OnboardingController],
  providers: [OperatorApplicationRepository, OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
