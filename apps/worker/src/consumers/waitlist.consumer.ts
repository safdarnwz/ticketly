import { Injectable, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type DomainEvent, type TripId } from '@kernel';

import { DemandService } from '@api/modules/demand/application/demand.service';

import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * A cancellation frees seats → tell the people waiting for that trip.
 * Idempotent: DemandService only notifies entries still 'waiting', and a
 * redelivered event finds nothing new to do.
 */
@Injectable()
export class WaitlistConsumer implements OnModuleInit {
  constructor(private readonly dispatcher: EventDispatcher, private readonly demand: DemandService, private readonly db: DatabaseService) {}

  onModuleInit(): void {
    for (const type of ['booking.cancelled', 'booking.seats_cancelled']) this.dispatcher.register(this.handler(type));
  }

  private handler(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const row = await this.db.queryOne<{ trip_id: string }>(
          `SELECT trip_id FROM bookings WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), event.aggregateId],
          { name: 'waitlist.tripOfBooking', primary: true });
        if (row) await this.demand.onSeatsFreed(row.trip_id as TripId);
      },
    };
  }
}
