import { Module } from '@nestjs/common';
import { ConcessionRepository } from './infrastructure/persistence/concession.repository';
import { ConcessionController } from './presentation/concession.controller';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { CrmModule } from '../crm/crm.module';
import { BookingController } from './presentation/booking.controller';
import { BookingRepository } from './infrastructure/persistence/booking.repository';
import { BookingService } from './application/services/booking.service';
import { TripOpsService } from './application/services/trip-ops.service';
import { SeatLockRepository } from './infrastructure/persistence/seat-lock.repository';
import { SeatUpgradeRepository } from './infrastructure/persistence/seat-upgrade.repository';
import { JourneyConnectionRepository } from './infrastructure/persistence/journey-connection.repository';
import { OperatorPolicyRepository } from './infrastructure/persistence/operator-policy.repository';

/**
 * Booking — the transactional core. Depends on pricing (quote re-validation,
 * coupon redemption) and scheduling (trips + the seat inventory it locks).
 * Exports the repositories the reporting (Part 10) and notification (Part 9)
 * modules consume. TripOpsService (cancel-a-whole-trip, stop/resume sales,
 * no-show) lives here rather than in scheduling — see its own doc comment
 * for why (it needs BookingService, and scheduling→booking would cycle).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    PricingModule,
    SchedulingModule,
    CrmModule,
  ],
  controllers: [BookingController, ConcessionController],
  providers: [
    OperatorPolicyRepository,
    JourneyConnectionRepository,
    BookingRepository,
    SeatLockRepository,
    SeatUpgradeRepository,
    BookingService,
    TripOpsService,
    ConcessionRepository,
  ],
  exports: [
    BookingRepository,
    JourneyConnectionRepository,
    SeatLockRepository,
    SeatUpgradeRepository,
    BookingService,
    TripOpsService,
    ConcessionRepository,
  ],
})
export class BookingModule {}
