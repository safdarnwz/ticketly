import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  RequirePlatformAdmin,
  zodQuery,
  type DateRangeQuery,
} from '@http';

import { NotificationLogRepository } from '../infrastructure/persistence/notification-log.repository';

/** SMS / WhatsApp / email delivery success rates across the platform (#112, #113). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/monitoring/messages', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class DeliveryMonitoringController {
  constructor(private readonly log: NotificationLogRepository) {}

  @Get()
  @ApiOperation({
    summary:
      'Per channel and provider: sent, failed, pending and delivery success rate (sent ÷ finished)',
  })
  async delivery(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    const rows = await this.log.deliveryStats(from, to);
    return {
      from,
      to,
      items: rows.map((r) => {
        const finished = r.sent + r.failed;
        return {
          ...r,
          successRate: finished === 0 ? null : Math.round((r.sent / finished) * 1000) / 1000,
        };
      }),
    };
  }
}
