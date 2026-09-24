import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { I18nService } from './application/services/i18n.service';
import { I18nRepository } from './infrastructure/persistence/i18n.repository';
import { I18nController } from './presentation/i18n.controller';

/**
 * i18n & multi-currency (Part 15). Platform-wide translation catalog with a
 * locale fallback chain, and on-the-fly currency conversion at the operator's
 * quoted rate. Resolution + integer-minor conversion + formatting are pure
 * (domain/translator.ts, domain/currency.ts).
 */
@Module({
  imports: [DatabaseModule],
  controllers: [I18nController],
  providers: [I18nRepository, I18nService],
  exports: [I18nService],
})
export class I18nModule {}
