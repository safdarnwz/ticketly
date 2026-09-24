import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission } from '@http';
import { localDate, requireTenantId } from '@kernel';

import { BookingRepository } from '../../booking/infrastructure/persistence/booking.repository';
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
  async revenue(@Query('from') from: string, @Query('to') to: string) {
    return this.reporting.revenue(localDate(from), localDate(to));
  }

  @Get('occupancy')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Daily occupancy over a date range' })
  async occupancy(@Query('from') from: string, @Query('to') to: string) {
    return { series: await this.reporting.occupancy(localDate(from), localDate(to)) };
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
  async revenueCsv(@Query('from') from: string, @Query('to') to: string) {
    return this.reporting.revenueCsv(localDate(from), localDate(to));
  }

  @Get('cancellations')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Cancellation trend + rate over a date range' })
  async cancellations(@Query('from') from: string, @Query('to') to: string) {
    return this.reporting.cancellationReport(localDate(from), localDate(to));
  }

  @Get('peak-hours')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Booking volume by hour of day — for staffing/counter-hours decisions' })
  async peakHours(@Query('from') from: string, @Query('to') to: string) {
    return { items: await this.reporting.peakHourReport(localDate(from), localDate(to)) };
  }
}
