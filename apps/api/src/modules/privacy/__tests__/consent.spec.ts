import { describe, it, expect } from 'vitest';

import {
  consentState,
  isProcessingAllowed,
  recordConsent,
  type ConsentEvent,
} from '../domain/consent';

const ev = (purpose: ConsentEvent['purpose'], granted: boolean, atMs: number): ConsentEvent => ({
  purpose,
  granted,
  atMs,
});

describe('consent', () => {
  it('happy: latest event per purpose wins', () => {
    const events = [
      ev('marketing', true, 100),
      ev('marketing', false, 200),
      ev('analytics', true, 150),
    ];
    expect(consentState(events)).toEqual({ marketing: false, analytics: true });
  });

  it('positive: transactional (necessary) is always allowed, even with no consent', () => {
    expect(isProcessingAllowed('transactional', [])).toBe(true);
  });

  it('positive: marketing allowed only after an explicit grant', () => {
    expect(isProcessingAllowed('marketing', [])).toBe(false);
    expect(isProcessingAllowed('marketing', [ev('marketing', true, 100)])).toBe(true);
  });

  it('negative: withdrawal takes effect (most recent event)', () => {
    const events = [ev('marketing', true, 100), ev('marketing', false, 200)];
    expect(isProcessingAllowed('marketing', events)).toBe(false);
  });

  it('negative: cannot withdraw a necessary purpose', () => {
    expect(() => recordConsent([], ev('transactional', false, 100))).toThrow();
  });

  it('edge: recordConsent appends without mutating the input', () => {
    const events: ConsentEvent[] = [];
    const next = recordConsent(events, ev('analytics', true, 100));
    expect(events).toHaveLength(0);
    expect(next).toHaveLength(1);
  });

  it('negative: an invalid timestamp is rejected', () => {
    expect(() => recordConsent([], ev('analytics', true, 0))).toThrow();
  });
});
