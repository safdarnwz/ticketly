import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ConnectingSearchController } from './presentation/connecting-search.controller';
import { ConnectingBookingController } from './presentation/connecting-booking.controller';
import { ConnectingSearchService } from './application/services/connecting-search.service';
import { ConnectingBookingService } from './application/services/connecting-booking.service';

/**
 * Connecting (multi-leg, cross-operator) journeys — e.g. Delhi -> Kolkata
 * on one operator, Kolkata -> Bhubaneswar on another, when no single
 * operator runs the full route. Genuinely cross-tenant (see migration
 * 0040's own comment): the search reads across every operator's routes
 * with bypassRls, and booking creates TWO ordinary bookings (one per
 * tenant, via the same BookingService every other booking uses) linked by
 * a platform-level record — this module adds the LINKING, not a new kind
 * of booking or a parallel seat-inventory system. PaymentModule and
 * TicketsModule support confirming and ticketing each leg through the
 * exact same code every single-leg booking already uses.
 */
@Module({
  imports: [DatabaseModule, BookingModule, PaymentModule, TicketsModule],
  controllers: [ConnectingSearchController, ConnectingBookingController],
  providers: [ConnectingSearchService, ConnectingBookingService],
  exports: [ConnectingSearchService, ConnectingBookingService],
})
export class ConnectionsModule {}
