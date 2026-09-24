import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { IamModule } from '../iam/iam.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { InvoiceController } from './presentation/invoice.controller';
import { InvoiceRepository } from './infrastructure/persistence/invoice.repository';
import { InvoiceService } from './application/services/invoice.service';

/**
 * GST tax invoicing (Part 13). Raises a compliant tax invoice on
 * `booking.confirmed` and a credit note on `booking.cancelled`, with a gapless
 * per-(tenant, financial-year) numbering series and a computed CGST/SGST vs
 * IGST tax split (never hand-entered, and never a hard-coded place-of-supply —
 * see InvoiceService, which asks MasterDataModule's RouteRepository). Pure tax
 * maths lives in domain/. IamModule (for Mailer) and TenancyModule (for the
 * supplier's own GSTIN/name/address) support the PDF-invoice email — see
 * InvoiceService.emailInvoicePdf.
 */
@Module({
  imports: [
    DatabaseModule,
    BookingModule,
    MasterDataModule,
    IamModule,
    TenancyModule,
    PlatformSettingsModule,
  ],
  controllers: [InvoiceController],
  providers: [InvoiceRepository, InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
