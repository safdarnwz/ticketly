import { describe, expect, it } from 'vitest';

import { assertRefundTransition, canRefundTransition, initialStatusFor, isRefundTerminal } from '../domain/refund-state';

describe('refund state machine', () => {
  it('source refund flows initiated→processing→settled', () => {
    expect(canRefundTransition('initiated', 'processing')).toBe(true);
    expect(canRefundTransition('processing', 'settled')).toBe(true);
  });

  it('no refund can jump straight from initiated to settled — it must be processed first', () => {
    expect(canRefundTransition('initiated', 'settled')).toBe(false);
    expect(canRefundTransition('initiated', 'processing')).toBe(true);
  });

  it('a failed refund can retry or go manual', () => {
    expect(canRefundTransition('failed', 'processing')).toBe(true);
    expect(canRefundTransition('failed', 'manual')).toBe(true);
  });

  it('forbids reviving a settled refund', () => {
    expect(canRefundTransition('settled', 'processing')).toBe(false);
    expect(() => assertRefundTransition('settled', 'processing')).toThrow(/cannot move/);
  });

  it('forbids settling straight from failed', () => {
    expect(canRefundTransition('failed', 'settled')).toBe(false);
  });

  it('identifies terminal states', () => {
    expect(isRefundTerminal('settled')).toBe(true);
    expect(isRefundTerminal('cancelled')).toBe(true);
    expect(isRefundTerminal('manual')).toBe(true);
    expect(isRefundTerminal('processing')).toBe(false);
  });

  it('every destination starts in processing (the wallet destination was removed)', () => {
    expect(initialStatusFor('source')).toBe('processing');
    expect(initialStatusFor('alternate_account')).toBe('processing');
  });
});
