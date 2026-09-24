import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { GdsRefundService } from './application/gds-refund.service';
import { GdsRepository } from './infrastructure/gds.repository';

/** GDS persistence + refund crediting, importable by the refunds module without cycles. */
@Module({
  imports: [DatabaseModule],
  providers: [GdsRepository, GdsRefundService],
  exports: [GdsRepository, GdsRefundService],
})
export class GdsLedgerModule {}
