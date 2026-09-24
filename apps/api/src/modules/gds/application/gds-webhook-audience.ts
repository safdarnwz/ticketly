import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  WebhookAudienceRegistry,
  type WebhookAudienceEvent,
  type WebhookAudienceResolver,
} from '../../webhooks';
import { GdsRepository } from '../infrastructure/gds.repository';

/**
 * Tells the webhook engine which GDS partner an event concerns:
 *  - booking / payment / refund events → the partner that sold that booking;
 *  - trip events (delay, departure) → every partner holding a live booking on the trip.
 */
@Injectable()
export class GdsWebhookAudience implements WebhookAudienceResolver, OnModuleInit {
  constructor(
    private readonly gds: GdsRepository,
    private readonly registry: WebhookAudienceRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async gdsPartnersFor(event: WebhookAudienceEvent): Promise<string[]> {
    if (event.aggregateType === 'trip')
      return this.gds.partnersWithBookingsOnTrip(event.aggregateId);
    const bookingId =
      event.aggregateType === 'booking'
        ? event.aggregateId
        : typeof event.payload.bookingId === 'string'
          ? event.payload.bookingId
          : null;
    if (!bookingId) return [];
    const owner = await this.gds.bookingOwner(bookingId);
    return owner?.partnerId ? [owner.partnerId] : [];
  }
}
