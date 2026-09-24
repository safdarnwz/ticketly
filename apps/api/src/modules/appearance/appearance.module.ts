import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { AppearanceService } from './application/services/appearance.service';
import { AppearanceRepository } from './infrastructure/persistence/appearance.repository';
import { AppearanceController } from './presentation/appearance.controller';

/**
 * Global Settings → Appearance (design system). Platform-wide and per-role design
 * tokens (colours, fonts, radii, shadows, component styles) that the frontend
 * hydrates into CSS variables at boot. Token schema, merge precedence and CSS
 * projection are pure (domain/theme.ts). Editing here re-skins every user of the
 * operator for that role.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AppearanceController],
  providers: [AppearanceRepository, AppearanceService],
  exports: [AppearanceService],
})
export class AppearanceModule {}
