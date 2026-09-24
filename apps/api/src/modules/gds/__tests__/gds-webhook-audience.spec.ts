import { describe, expect, it } from 'vitest';

import { WebhookAudienceRegistry } from '../../webhooks';
import { GdsWebhookAudience } from '../application/gds-webhook-audience';

function audience(owner: Record<string, string | null>, onTrip: Record<string, string[]> = {}) {
  const repo = {
    bookingOwner: async (id: string) =>
      id in owner ? { tenantId: 't', partnerId: owner[id]! } : null,
    partnersWithBookingsOnTrip: async (tripId: string) => onTrip[tripId] ?? [],
  };
  return new GdsWebhookAudience(repo as never, new WebhookAudienceRegistry());
}
const ev = (aggregateType: string, aggregateId: string, payload: Record<string, unknown> = {}) => ({
  tenantId: 't',
  eventType: 'x',
  aggregateType,
  aggregateId,
  payload,
});

describe('GdsWebhookAudience', () => {
  it('booking events go to the partner that sold the booking', async () => {
    expect(await audience({ b1: 'p1' }).gdsPartnersFor(ev('booking', 'b1'))).toEqual(['p1']);
  });
  it('payment/refund events resolve the booking from the payload', async () => {
    expect(
      await audience({ b1: 'p1' }).gdsPartnersFor(ev('payment', 'i1', { bookingId: 'b1' })),
    ).toEqual(['p1']);
  });
  it('a booking not sold via GDS reaches no partner', async () => {
    expect(await audience({ b1: null }).gdsPartnersFor(ev('booking', 'b1'))).toEqual([]);
    expect(await audience({}).gdsPartnersFor(ev('payment', 'i1'))).toEqual([]);
  });
  it('trip events go to every partner with a live booking on the trip', async () => {
    expect(await audience({}, { t1: ['p1', 'p2'] }).gdsPartnersFor(ev('trip', 't1'))).toEqual([
      'p1',
      'p2',
    ]);
  });
});

describe('WebhookAudienceRegistry', () => {
  it('merges and de-duplicates every resolver', async () => {
    const r = new WebhookAudienceRegistry();
    r.register({ gdsPartnersFor: async () => ['p1', 'p2'] });
    r.register({ gdsPartnersFor: async () => ['p2', 'p3'] });
    expect(await r.gdsPartnersFor(ev('booking', 'b'))).toEqual(['p1', 'p2', 'p3']);
  });
});
