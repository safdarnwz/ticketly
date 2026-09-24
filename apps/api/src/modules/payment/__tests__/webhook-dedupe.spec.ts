import { describe, expect, it } from 'vitest';

import { webhookDedupeKey } from '../infrastructure/gateways/gateway.interface';

describe('webhookDedupeKey', () => {
  it('the same payment id as different events are NOT duplicates (authorized → captured)', () => {
    const a = webhookDedupeKey({ type: 'payment.authorized', gatewayPaymentId: 'pay_1' });
    const c = webhookDedupeKey({ type: 'payment.captured', gatewayPaymentId: 'pay_1' });
    expect(a).not.toBe(c);
  });
  it('a refund of that payment is not a duplicate of its capture', () => {
    const c = webhookDedupeKey({ type: 'payment.captured', gatewayPaymentId: 'pay_1' });
    const r = webhookDedupeKey({ type: 'refund.processed', gatewayPaymentId: 'pay_1', gatewayRefundId: 'rfnd_9' });
    expect(r).not.toBe(c);
  });
  it('two partial refunds of one payment are distinct; a redelivery of the same one is a duplicate', () => {
    const r1 = webhookDedupeKey({ type: 'refund.processed', gatewayPaymentId: 'pay_1', gatewayRefundId: 'rfnd_1' });
    const r2 = webhookDedupeKey({ type: 'refund.processed', gatewayPaymentId: 'pay_1', gatewayRefundId: 'rfnd_2' });
    expect(r1).not.toBe(r2);
    expect(webhookDedupeKey({ type: 'refund.processed', gatewayPaymentId: 'pay_1', gatewayRefundId: 'rfnd_1' })).toBe(r1);
  });
  it('an exact redelivery of the same capture is a duplicate', () => {
    expect(webhookDedupeKey({ type: 'payment.captured', gatewayPaymentId: 'pay_1' })).toBe(webhookDedupeKey({ type: 'payment.captured', gatewayPaymentId: 'pay_1' }));
  });
});
