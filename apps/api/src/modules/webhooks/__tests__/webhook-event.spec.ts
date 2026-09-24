import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { nextRetryMinutes, signWebhookBody, WEBHOOK_EVENTS } from '../domain/webhook-event';

describe('webhook signing', () => {
  it('is sha256=HMAC(secret, raw body) — what receivers verify', () => {
    const body = JSON.stringify({ event: 'booking.confirmed', data: { pnr: 'TK1' } });
    const expected = createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(signWebhookBody('s3cret', body)).toBe(`sha256=${expected}`);
  });
  it('changes when the body changes', () => {
    expect(signWebhookBody('k', '{"a":1}')).not.toBe(signWebhookBody('k', '{"a":2}'));
  });
});

describe('retry schedule', () => {
  it('backs off 1, 5, 30, 180 minutes then gives up', () => {
    expect([0, 1, 2, 3].map(nextRetryMinutes)).toEqual([1, 5, 30, 180]);
    expect(nextRetryMinutes(4)).toBeNull();
  });
});

describe('catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(WEBHOOK_EVENTS).size).toBe(WEBHOOK_EVENTS.length);
  });
});
