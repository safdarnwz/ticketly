import { describe, expect, it } from 'vitest';

import {
  assertTransition, canTransition, holdsInventory, isCancellable, isTerminal,
  type BookingStatus,
} from '../domain/booking-state';

describe('booking state machine — legal transitions', () => {
  it('allows the happy path pending→held→confirmed→completed', () => {
    expect(canTransition('pending', 'held')).toBe(true);
    expect(canTransition('held', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'completed')).toBe(true);
  });

  it('allows a held booking to expire or be cancelled', () => {
    expect(canTransition('held', 'expired')).toBe(true);
    expect(canTransition('held', 'cancelled')).toBe(true);
  });

  it('allows a confirmed booking to be cancelled', () => {
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
  });
});

describe('booking state machine — illegal transitions', () => {
  it('forbids confirming a cancelled booking', () => {
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(() => assertTransition('cancelled', 'confirmed')).toThrow(/Cannot move/);
  });

  it('forbids cancelling a completed booking', () => {
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  it('forbids skipping held (pending→confirmed)', () => {
    expect(canTransition('pending', 'confirmed')).toBe(false);
  });

  it('forbids reviving an expired hold', () => {
    expect(canTransition('expired', 'held')).toBe(false);
  });
});

describe('booking state machine — predicates', () => {
  it('identifies terminal states', () => {
    (['completed', 'cancelled', 'expired', 'failed'] as BookingStatus[]).forEach((s) => expect(isTerminal(s)).toBe(true));
    (['pending', 'held', 'confirmed'] as BookingStatus[]).forEach((s) => expect(isTerminal(s)).toBe(false));
  });

  it('identifies inventory-holding states', () => {
    expect(holdsInventory('held')).toBe(true);
    expect(holdsInventory('confirmed')).toBe(true);
    expect(holdsInventory('expired')).toBe(false);
    expect(holdsInventory('cancelled')).toBe(false);
  });

  it('identifies cancellable states', () => {
    expect(isCancellable('held')).toBe(true);
    expect(isCancellable('confirmed')).toBe(true);
    expect(isCancellable('completed')).toBe(false);
    expect(isCancellable('pending')).toBe(false);
  });
});
