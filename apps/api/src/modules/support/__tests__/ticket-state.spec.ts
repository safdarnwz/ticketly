import { describe, it, expect } from 'vitest';

import {
  assertTicketTransition,
  canTicketTransition,
  isTicketClosed,
  statusAfterMessage,
} from '../domain/ticket-state';

describe('ticket transitions', () => {
  it('happy: full lifecycle open → pending → resolved → closed', () => {
    expect(canTicketTransition('open', 'pending')).toBe(true);
    expect(canTicketTransition('pending', 'resolved')).toBe(true);
    expect(canTicketTransition('resolved', 'closed')).toBe(true);
  });

  it('positive: resolved can be reopened', () => {
    expect(canTicketTransition('resolved', 'open')).toBe(true);
  });

  it('negative: nothing transitions out of closed', () => {
    expect(canTicketTransition('closed', 'open')).toBe(false);
    expect(isTicketClosed('closed')).toBe(true);
    expect(() => assertTicketTransition('closed', 'open')).toThrow();
  });

  it('edge: a same-status transition is an idempotent no-op (no throw)', () => {
    expect(() => assertTicketTransition('open', 'open')).not.toThrow();
  });

  it('negative: assert throws on an illegal jump', () => {
    // resolved → pending is not allowed
    expect(() => assertTicketTransition('resolved', 'pending')).toThrow();
  });
});

describe('statusAfterMessage', () => {
  it('happy: a customer reply reopens a resolved/pending ticket', () => {
    expect(statusAfterMessage('resolved', 'customer')).toBe('open');
    expect(statusAfterMessage('pending', 'customer')).toBe('open');
  });

  it('positive: an agent reply on an open ticket moves it to pending', () => {
    expect(statusAfterMessage('open', 'agent')).toBe('pending');
  });

  it('positive: an agent reply on a pending ticket keeps it pending', () => {
    expect(statusAfterMessage('pending', 'agent')).toBe('pending');
  });

  it('edge: a system note never moves the ticket', () => {
    expect(statusAfterMessage('open', 'system')).toBe('open');
    expect(statusAfterMessage('resolved', 'system')).toBe('resolved');
  });

  it('edge: a closed ticket stays closed regardless of author', () => {
    expect(statusAfterMessage('closed', 'customer')).toBe('closed');
    expect(statusAfterMessage('closed', 'agent')).toBe('closed');
  });
});
