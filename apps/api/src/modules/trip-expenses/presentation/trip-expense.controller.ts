import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import { BadRequestError, type TripId } from '@kernel';

import { TripExpenseService } from '../application/trip-expense.service';
import { EXPENSE_CATEGORIES } from '../domain/pnl';

const AddExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: z.number().int().positive(),
  note: z.string().trim().max(300).optional(),
  receiptFileId: z.string().uuid().optional(),
});
const VoidSchema = z.object({ reason: z.string().trim().min(5).max(300) });
const ReportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupBy: z.enum(['trip', 'route', 'vehicle']).default('route'),
  routeId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional(),
});

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
  @ApiOperation({ summary: 'Add a trip expense (diesel, toll, bata, ...) — optionally with an uploaded receipt' })
  async add(@Param('tripId') tripId: string, @Body(zodBody(AddExpenseSchema)) dto: z.infer<typeof AddExpenseSchema>) {
    return this.svc.add(tripId as TripId, dto);
  }

  @Post('trips/:tripId/expenses/receipt')
  @HttpCode(201)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Upload a receipt as raw bytes (PDF/JPG/PNG/WEBP ≤ 5 MB) → fileId for the expense' })
  async receipt(@Param('tripId') tripId: string, @Query('fileName') fileName: string | undefined, @Body() body: Buffer) {
    if (!Buffer.isBuffer(body) || (body as Buffer).length === 0) throw new BadRequestError('Send the receipt as raw bytes with Content-Type: application/octet-stream');
    return this.svc.uploadReceipt(tripId as TripId, body as Buffer, fileName);
  }

  @Get('trips/:tripId/expenses')
  @RequirePermission(Permission.TRIP_OPERATE)
  async list(@Param('tripId') tripId: string, @Query('includeVoided') includeVoided?: string) {
    return { items: await this.svc.list(tripId as TripId, includeVoided === '1') };
  }

  @Post('trips/:tripId/expenses/:expenseId/void')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_MANAGE)
  @ApiOperation({ summary: 'Void a wrong expense with a reason (never deleted — audit trail)' })
  async void(@Param('tripId') tripId: string, @Param('expenseId') expenseId: string, @Body(zodBody(VoidSchema)) dto: z.infer<typeof VoidSchema>) {
    return this.svc.void(tripId as TripId, expenseId, dto.reason);
  }

  @Get('trips/:tripId/pnl')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Trip profit & loss' })
  async tripPnl(@Param('tripId') tripId: string) {
    return this.svc.tripPnl(tripId as TripId);
  }

  @Get('reports/pnl')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({ summary: 'Profit & loss over a period (≤ 92 days), grouped by trip, route or bus — worst first' })
  async report(@Query() q: Record<string, string>) {
    const parsed = ReportQuery.safeParse(q);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid report query');
    return this.svc.report(parsed.data);
  }
}
