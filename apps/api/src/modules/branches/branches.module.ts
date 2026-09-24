import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BranchController } from './presentation/branch.controller';
import { BranchRepository } from './infrastructure/persistence/branch.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [BranchController],
  providers: [BranchRepository],
  exports: [BranchRepository],
})
export class BranchesModule {}
