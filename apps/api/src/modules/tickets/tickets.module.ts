import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { SecurityModule } from '@security';

import { BookingModule } from '../booking/booking.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TrackingModule } from '../tracking/tracking.module';
import { NotificationModule } from '../notification/notification.module';
import { TicketService } from './application/services/ticket.service';
import { TicketController } from './presentation/ticket.controller';

/**
 * Tickets (Part 15). Issues HMAC-signed boarding tokens (the QR content) that
 * the conductor app verifies OFFLINE at the gate, and renders a printable HTML
 * e-ticket. Token encoding/verification logic is pure (domain/ticket-token.ts);
 * the signing key is derived from the platform secret via @security.
 */
@Module({
  imports: [
    ConfigModule,
    SecurityModule,
    BookingModule,
    SchedulingModule,
    MasterDataModule,
    TenancyModule,
    TrackingModule,
    NotificationModule,
  ],
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketsModule {}
