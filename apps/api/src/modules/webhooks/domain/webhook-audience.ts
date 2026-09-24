/**
 * Besides the operator's own endpoints, an event may concern a platform-level
 * party (a GDS partner that sold the booking). Channels that own such parties
 * register a resolver, so this module never imports them.
 */
export interface WebhookAudienceEvent {
  tenantId: string;
  eventType: string;
  /** e.g. 'booking' / 'trip' / 'payment' — with aggregateId, what the event is about. */
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface WebhookAudienceResolver {
  /** GDS partner ids that should receive this event. */
  gdsPartnersFor(event: WebhookAudienceEvent): Promise<string[]>;
}
