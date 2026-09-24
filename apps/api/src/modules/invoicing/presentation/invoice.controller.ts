import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import { type BookingId } from '@kernel';

import { InvoiceService } from '../application/services/invoice.service';

const IssueInvoiceSchema = z.object({
  bookingId: z.string().uuid(),
  // NOTE: interState deliberately removed — computed from the booking's
  // route (see InvoiceService.issueForBooking), never client-supplied.
  supplierGstin: z.string().min(15).max(15).optional(),
});

/**
 * GST invoicing endpoints. Invoices are normally raised automatically on
 * confirmation (worker); these expose reading a booking's invoices and issuing
 * one on demand. Numbering is gapless per financial year (a GST requirement).
 */
@ApiTags('invoicing')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('bookings/:bookingId/invoices')
  @RequirePermission(Permission.PAYMENT_READ)
  @ApiOperation({ summary: 'List invoices/credit notes for a booking' })
  async list(@UuidParam('bookingId') bookingId: string) {
    return { invoices: await this.invoices.listForBooking(bookingId as BookingId) };
  }

  @Post('invoices')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Issue a GST tax invoice for a confirmed booking' })
  async issue(@Body(zodBody(IssueInvoiceSchema)) dto: z.infer<typeof IssueInvoiceSchema>) {
    const result = await this.invoices.issueForBooking(
      dto.bookingId as BookingId,
      dto.supplierGstin,
    );
    return result ?? { issued: false, reason: 'Booking is not confirmed' };
  }
}
