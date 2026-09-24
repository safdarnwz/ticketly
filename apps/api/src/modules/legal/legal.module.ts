import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { LegalController } from './presentation/legal.controller';
import { LegalRepository } from './infrastructure/persistence/legal.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [LegalController],
  providers: [LegalRepository],
  exports: [LegalRepository],
})
export class LegalModule {}
