import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  FileUploadQuerySchema,
  Idempotent,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
  type FileUploadQuery,
} from '@http';
import { BadRequestError, type TripId } from '@kernel';

import { TripExpenseService } from '../application/trip-expense.service';
import {
  AddExpenseSchema,
  ListExpensesQuerySchema,
  PnlReportQuerySchema,
  VoidExpenseSchema,
  type AddExpenseDto,
  type ListExpensesQueryDto,
  type PnlReportQueryDto,
  type VoidExpenseDto,
} from './dto/trip-expense.dto';

@ApiTags('trip-expenses')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class TripExpenseController {
  constructor(private readonly svc: TripExpenseService) {}

  @Post('trips/:tripId/expenses')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Add a trip expense (diesel, toll, bata, ...) — optionally with an uploaded receipt',
  })
  async add(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(AddExpenseSchema)) dto: AddExpenseDto,
  ) {
    return this.svc.add(tripId as TripId, dto);
  }

  @Post('trips/:tripId/expenses/receipt')
  @HttpCode(201)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({
    summary: 'Upload a receipt as raw bytes (PDF/JPG/PNG/WEBP ≤ 5 MB) → fileId for the expense',
  })
  async receipt(
    @UuidParam('tripId') tripId: string,
    @Query(zodQuery(FileUploadQuerySchema)) { fileName }: FileUploadQuery,
    @Body() body: Buffer,
  ) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestError(
        'Send the receipt as raw bytes with Content-Type: application/octet-stream',
      );
    return this.svc.uploadReceipt(tripId as TripId, body, fileName);
  }

  @Get('trips/:tripId/expenses')
  @RequirePermission(Permission.TRIP_OPERATE)
  async list(
    @UuidParam('tripId') tripId: string,
    @Query(zodQuery(ListExpensesQuerySchema)) q: ListExpensesQueryDto,
  ) {
    return { items: await this.svc.list(tripId as TripId, q.includeVoided) };
  }

  @Post('trips/:tripId/expenses/:expenseId/void')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  @ApiOperation({ summary: 'Void a wrong expense with a reason (never deleted — audit trail)' })
  async void(
    @UuidParam('tripId') tripId: string,
    @UuidParam('expenseId') expenseId: string,
    @Body(zodBody(VoidExpenseSchema)) dto: VoidExpenseDto,
  ) {
    return this.svc.void(tripId as TripId, expenseId, dto.reason);
  }

  @Get('trips/:tripId/pnl')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Trip profit & loss' })
  async tripPnl(@UuidParam('tripId') tripId: string) {
    return this.svc.tripPnl(tripId as TripId);
  }

  @Get('reports/pnl')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary: 'Profit & loss over a period (≤ 92 days), grouped by trip, route or bus — worst first',
  })
  async report(@Query(zodQuery(PnlReportQuerySchema)) q: PnlReportQueryDto) {
    return this.svc.report(q);
  }
}
