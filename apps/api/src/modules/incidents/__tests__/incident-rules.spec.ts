import { describe, expect, it } from 'vitest';

import { assertTransition, canDispose, checkClaim, isOverdue, severityFor, validateReport } from '../domain/incident-rules';

describe('incident reports', () => {
  it('SOS needs no typing; others need a description', () => {
    expect(() => validateReport({ type: 'sos' })).not.toThrow();
    expect(() => validateReport({ type: 'breakdown', description: 'x' })).toThrow(/Describe/);
  });
  it('severity by type: SOS / medical / security / accident are critical', () => {
    expect(['sos', 'medical', 'security', 'accident'].map((t) => severityFor(t as never))).toEqual(['critical', 'critical', 'critical', 'critical']);
    expect(severityFor('breakdown')).toBe('high');
    expect(severityFor('complaint')).toBe('normal');
  });
  it('delay needs category and minutes (567); diversion needs the route (588)', () => {
    expect(() => validateReport({ type: 'delay', description: 'Jam at toll', delayCategory: 'traffic', delayMinutes: 40 })).not.toThrow();
    expect(() => validateReport({ type: 'delay', description: 'Jam at toll', delayMinutes: 40 })).toThrow(/category/);
    expect(() => validateReport({ type: 'delay', description: 'Jam at toll', delayCategory: 'traffic', delayMinutes: 0 })).toThrow(/1 minute/);
    expect(() => validateReport({ type: 'diversion', description: 'Bridge closed' })).toThrow(/diverted/);
  });
  it('location must be complete and real', () => {
    expect(() => validateReport({ type: 'sos', lat: 26.9 })).toThrow(/both/);
    expect(() => validateReport({ type: 'sos', lat: 126.9, lng: 75.8 })).toThrow(/valid coordinate/);
    expect(() => validateReport({ type: 'unknown', description: 'hello' })).toThrow(/Unknown/);
  });
});

describe('incident workflow', () => {
  it('open → acknowledged → resolved → closed; resolution note required; closed is final', () => {
    expect(() => assertTransition('open', 'acknowledged')).not.toThrow();
    expect(() => assertTransition('acknowledged', 'resolved')).toThrow(/resolution note/);
    expect(() => assertTransition('acknowledged', 'resolved', 'Mechanic fixed it')).not.toThrow();
    expect(() => assertTransition('closed', 'open')).toThrow(/cannot become/);
    expect(() => assertTransition('open', 'closed')).toThrow(/cannot become/);
  });
  it('critical SOS unacknowledged after 5 minutes is overdue', () => {
    const at = new Date('2026-10-01T10:00:00Z');
    expect(isOverdue({ severity: 'critical', status: 'open', reportedAt: at }, new Date('2026-10-01T10:06:00Z'))).toBe(true);
    expect(isOverdue({ severity: 'critical', status: 'acknowledged', reportedAt: at }, new Date('2026-10-01T11:00:00Z'))).toBe(false);
    expect(isOverdue({ severity: 'normal', status: 'open', reportedAt: at }, new Date('2026-10-01T10:30:00Z'))).toBe(false);
  });
});

describe('lost & found (402 / 607 / 659)', () => {
  it('claim only by a passenger of that trip, only while held', () => {
    expect(checkClaim({ itemStatus: 'found', itemTripId: 't1', claimPnrTripId: 't1', claimantName: 'Asha' })).toBeNull();
    expect(checkClaim({ itemStatus: 'found', itemTripId: 't1', claimPnrTripId: 't2', claimantName: 'Asha' })).toMatch(/not for the trip/);
    expect(checkClaim({ itemStatus: 'claimed', itemTripId: 't1', claimPnrTripId: 't1', claimantName: 'Asha' })).toMatch(/already claimed/);
  });
  it('disposal only after 30 days unclaimed', () => {
    const found = new Date('2026-09-01T00:00:00Z');
    expect(canDispose({ itemStatus: 'found', foundAt: found }, new Date('2026-09-20T00:00:00Z'))).toMatch(/30 days/);
    expect(canDispose({ itemStatus: 'found', foundAt: found }, new Date('2026-10-02T00:00:00Z'))).toBeNull();
  });
});
