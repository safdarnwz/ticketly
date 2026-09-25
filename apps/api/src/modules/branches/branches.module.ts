import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../entitlements/entitlements.module';
import { BranchService } from './application/branch.service';

import { DatabaseModule } from '@database';

import { BranchController } from './presentation/branch.controller';
import { BranchRepository } from './infrastructure/persistence/branch.repository';

@Module({
  imports: [DatabaseModule, EntitlementsModule],
  controllers: [BranchController],
  providers: [BranchRepository, BranchService],
  exports: [BranchRepository],
})
export class BranchesModule {}
