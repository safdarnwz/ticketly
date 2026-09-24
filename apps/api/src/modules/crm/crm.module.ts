import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { SecurityModule } from '@security';

import { CrmController } from './presentation/crm.controller';
import { CustomerRepository } from './infrastructure/persistence/customer.repository';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [CrmController],
  providers: [CustomerRepository],
  exports: [CustomerRepository],
})
export class CrmModule {}
