import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  RequirePlatformAdmin,
  zodQuery,
  type DateRangeQuery,
} from '@http';

import { PaymentRepository } from '../infrastructure/persistence/payment.repository';

/** Payment gateway success rates across the platform (#111). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/monitoring/payments', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class PaymentMonitoringController {
  constructor(private readonly payments: PaymentRepository) {}

  @Get()
  @ApiOperation({
    summary:
      'Per gateway: attempts, captured, failed, abandoned and success rate (captured ÷ finished attempts)',
  })
  async gateways(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    const rows = await this.payments.gatewayStats(from, to);
    return {
      from,
      to,
      items: rows.map((r) => {
        const finished = r.captured + r.failed + r.abandoned;
        return {
          ...r,
          successRate: finished === 0 ? null : Math.round((r.captured / finished) * 1000) / 1000,
        };
      }),
    };
  }
}
