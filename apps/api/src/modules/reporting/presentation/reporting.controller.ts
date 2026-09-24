import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  RequirePermission,
  zodQuery,
  type DateRangeQuery,
} from '@http';
import { requireTenantId } from '@kernel';

import { BookingRepository } from '../../booking';
import { ReportingService } from '../application/services/reporting.service';

@ApiTags('reporting')
@ApiBearerAuth('bearer')
@Controller({ path: 'reports', version: '1' })
@ApiStandardErrors()
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly bookings: BookingRepository,
  ) {}

  @Get('summary')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary:
      "This operator's own dashboard numbers — total/today bookings, total/today cancellations, revenue",
  })
  async summary() {
    return this.bookings.statsForTenant(requireTenantId());
  }

  @Get('revenue')
  @RequirePermission(Permission.REPORT_READ)
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiOperation({ summary: 'Revenue over a date range' })
  async revenue(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    return this.reporting.revenue(from, to);
  }

  @Get('occupancy')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Daily occupancy over a date range' })
  async occupancy(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    return { series: await this.reporting.occupancy(from, to) };
  }

  @Get('routes/performance')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Route occupancy & revenue (last 30 days)' })
  async routePerformance() {
    return { routes: await this.reporting.routePerformance() };
  }

  @Get('revenue.csv')
  @RequirePermission(Permission.REPORT_EXPORT)
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="revenue.csv"')
  @ApiOperation({ summary: 'Export revenue as CSV' })
  async revenueCsv(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    return this.reporting.revenueCsv(from, to);
  }

  @Get('cancellations')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Cancellation trend + rate over a date range' })
  async cancellations(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    return this.reporting.cancellationReport(from, to);
  }

  @Get('peak-hours')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Booking volume by hour of day — for staffing/counter-hours decisions' })
  async peakHours(@Query(zodQuery(DateRangeQuerySchema)) { from, to }: DateRangeQuery) {
    return { items: await this.reporting.peakHourReport(from, to) };
  }
}
