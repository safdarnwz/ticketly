import { describe, expect, it } from 'vitest';

import { RefundCreditorRegistry } from '../application/services/refund-creditor.registry';
import type { RefundCreditor } from '../domain/refund-creditor';

const creditor = (gateway: string): RefundCreditor => ({
  gateway,
  collectedBy: 'operator',
  destination: `${gateway}_account`,
  channel: gateway,
  missingAccountReason: 'none',
  creditRefund: async () => ({ clawbackMinor: 0 }),
});

describe('RefundCreditorRegistry', () => {
  it('finds a creditor by payment gateway', () => {
    const r = new RefundCreditorRegistry();
    const agent = creditor('agent');
    r.register(agent);
    expect(r.for('agent')).toBe(agent);
  });
  it('returns undefined for PSP gateways and missing intents', () => {
    const r = new RefundCreditorRegistry();
    r.register(creditor('agent'));
    expect(r.for('razorpay')).toBeUndefined();
    expect(r.for(null)).toBeUndefined();
    expect(r.for(undefined)).toBeUndefined();
  });
  it('refuses two creditors for one gateway', () => {
    const r = new RefundCreditorRegistry();
    r.register(creditor('gds'));
    expect(() => r.register(creditor('gds'))).toThrow(/already registered/);
  });
});
