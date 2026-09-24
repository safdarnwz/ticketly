import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { FilesModule } from '../files/files.module';
import { TripExpenseService } from './application/trip-expense.service';
import { TripExpenseController } from './presentation/trip-expense.controller';
import { TripExpenseRepository } from './infrastructure/persistence/trip-expense.repository';

/** Trip running costs and trip / route / bus profit & loss. */
@Module({
  imports: [DatabaseModule, FilesModule],
  controllers: [TripExpenseController],
  providers: [TripExpenseRepository, TripExpenseService],
})
export class TripExpensesModule {}
