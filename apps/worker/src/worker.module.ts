import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { TenantRateLimitsModule } from '@http';
import { MessagingModule } from '@messaging';
import { ObservabilityModule } from '@observability';

import { NotificationModule } from '@api/modules/notification/notification.module';
import { InvoiceModule } from '@api/modules/invoicing/invoice.module';
import { TicketsModule } from '@api/modules/tickets/tickets.module';
import { RefundModule } from '@api/modules/refunds/refund.module';
import { TrackingModule } from '@api/modules/tracking/tracking.module';
import { WebhooksModule } from '@api/modules/webhooks/webhooks.module';
import { BookingModule } from '@api/modules/booking/booking.module';
import { PaymentModule } from '@api/modules/payment/payment.module';
import { TenancyModule } from '@api/modules/tenancy/tenancy.module';
import { EventDispatcher } from './dispatcher/event-dispatcher';
import { OutboxDispatcher } from './dispatcher/outbox-dispatcher';
import { NotificationConsumer } from './consumers/notification.consumer';
import { InvoiceConsumer } from './consumers/invoice.consumer';
import { TicketEmailConsumer } from './consumers/ticket-email.consumer';
import { RefundConsumer } from './consumers/refund.consumer';
import { AmendmentConsumer } from './consumers/amendment.consumer';
import { WebhookConsumer } from './consumers/webhook.consumer';
import { PayoutConsumer } from './consumers/payout.consumer';
import { SchedulerService } from './schedulers/scheduler.service';
import { FleetModule } from '@api/modules/fleet/fleet.module';
import { QuotasModule } from '@api/modules/quotas/quotas.module';
import { DemandModule } from '@api/modules/demand/demand.module';
import { PlatformSettingsModule } from '@api/modules/platform-settings/platform-settings.module';
import { WaitlistConsumer } from './consumers/waitlist.consumer';
import { PayoutScheduler } from './schedulers/payout.scheduler';
import { TripReminderScheduler } from './schedulers/trip-reminder.scheduler';
import { JourneyDetailsService } from './schedulers/journey-details.service';
import { ConnectionMonitorScheduler } from './schedulers/connection-monitor.scheduler';
import { InventoryHorizonScheduler } from './schedulers/inventory-horizon.scheduler';
import { SchedulingModule } from '@api/modules/scheduling/scheduling.module';
import { AgentsModule } from '@api/modules/agents/agents.module';
import { GdsModule } from '@api/modules/gds/gds.module';

/**
 * Worker composition root.
 *
 * Runs the reliability machinery that must live OUTSIDE the request path:
 *  - OutboxDispatcher  — drains outbox_events and fans out to handlers
 *    (at-least-once, FOR UPDATE SKIP LOCKED).
 *  - EventDispatcher   — routes each event to its subscribed handlers.
 *  - NotificationConsumer — reacts to booking/trip events → notifications.
 *  - WebhookConsumer   — reacts to the same + payment/refund events →
 *    signed POSTs to registered OTA/GDS partner webhooks.
 *  - SchedulerService  — seat-hold sweeper, partition maintenance, purges,
 *    the webhook retry sweep, AND the twice-weekly automated payout
 *    (PayoutScheduler — Mon-Wed bookings pay out Thursday, Thu-Sun pay out
 *    the following Monday, across every active operator).
 *
 * It shares the exact same feature modules as the API (NotificationModule here),
 * so there is no code duplication between the two processes — just a different
 * entry point and no HTTP server.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    CacheModule,
    MessagingModule,
    NotificationModule,
    BookingModule,
    InvoiceModule,
    TicketsModule,
    RefundModule,
    TrackingModule,
    WebhooksModule,
    PaymentModule,
    TenancyModule,
    FleetModule,
    QuotasModule,
    DemandModule,
    PlatformSettingsModule,
    SchedulingModule,
    // Refund creditors for agent and OTA/GDS sales register themselves at startup:
    // without them the worker's automatic refund of such a cancellation failed.
    AgentsModule,
    GdsModule,
    // The tenancy module registers operator rate limits here; no HTTP layer in the worker.
    TenantRateLimitsModule,
  ],
  providers: [
    EventDispatcher,
    OutboxDispatcher,
    NotificationConsumer,
    WaitlistConsumer,
    InvoiceConsumer,
    TicketEmailConsumer,
    RefundConsumer,
    AmendmentConsumer,
    WebhookConsumer,
    PayoutConsumer,
    SchedulerService,
    PayoutScheduler,
    TripReminderScheduler,
    JourneyDetailsService,
    ConnectionMonitorScheduler,
    InventoryHorizonScheduler,
  ],
})
export class WorkerModule {}
