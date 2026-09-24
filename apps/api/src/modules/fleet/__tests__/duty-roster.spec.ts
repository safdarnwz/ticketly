import { describe, expect, it } from 'vitest';

import { checkAssignment, DEFAULT_REST_RULES, type Duty } from '../domain/duty-roster';

const H = 3_600_000; // ms per hour
const base = Date.UTC(2026, 2, 15, 0, 0, 0); // 2026-03-15 00:00 UTC

function duty(id: string, crewId: string, startH: number, endH: number, drivingMin?: number): Duty {
  return {
    id,
    crewId,
    startMs: base + startH * H,
    endMs: base + endH * H,
    drivingMinutes: drivingMin,
  };
}

describe('checkAssignment — happy path', () => {
  it('allows a duty with no existing duties', () => {
    const r = checkAssignment(duty('t1', 'd1', 6, 14, 480), []);
    expect(r.ok).toBe(true);
  });

  it('allows a second duty for the same crew with adequate rest', () => {
    const existing = [duty('t1', 'd1', 0, 8, 300)]; // 5h driving
    // next duty starts 16:00 (8h rest after 08:00 end), 4h driving → 9h total < 10h cap
    const r = checkAssignment(duty('t2', 'd1', 16, 22, 240), existing);
    expect(r.ok).toBe(true);
  });

  it('allows overlapping duties for DIFFERENT crew', () => {
    const existing = [duty('t1', 'd1', 6, 14, 480)];
    const r = checkAssignment(duty('t2', 'd2', 6, 14, 480), existing);
    expect(r.ok).toBe(true);
  });
});

describe('checkAssignment — negative & edge', () => {
  it('rejects an overlapping duty for the same crew', () => {
    const existing = [duty('t1', 'd1', 6, 14, 480)];
    const r = checkAssignment(duty('t2', 'd1', 10, 18, 480), existing);
    expect(r.ok).toBe(false);
    expect(r.conflicts.some((c) => c.kind === 'overlap')).toBe(true);
    expect(r.conflicts[0].conflictingDutyId).toBe('t1');
  });

  it('rejects insufficient rest between adjacent duties', () => {
    const existing = [duty('t1', 'd1', 0, 8, 480)];
    // next starts 12:00, only 4h after 08:00 end → < 8h rest
    const r = checkAssignment(duty('t2', 'd1', 12, 18, 360), existing);
    expect(r.ok).toBe(false);
    expect(r.conflicts.some((c) => c.kind === 'insufficient_rest')).toBe(true);
  });

  it('rejects a duty exceeding the single-duty length cap', () => {
    const r = checkAssignment(duty('t1', 'd1', 0, 17, 600), []); // 17h > 16h cap
    expect(r.ok).toBe(false);
    expect(r.conflicts.some((c) => c.kind === 'exceeds_duty_length')).toBe(true);
  });

  it('rejects exceeding the daily driving cap across two duties in 24h', () => {
    // Two duties, 6h + 6h driving within same 24h, plus candidate — total > 10h.
    const existing = [duty('t1', 'd1', 0, 7, 360)]; // 6h driving
    const candidate = duty('t2', 'd1', 15, 22, 360); // 6h driving, 8h rest ok
    const r = checkAssignment(candidate, existing, DEFAULT_REST_RULES);
    expect(r.conflicts.some((c) => c.kind === 'exceeds_daily_driving')).toBe(true);
  });

  it('rejects a duty whose end is before its start', () => {
    const r = checkAssignment(duty('t1', 'd1', 14, 6), []);
    expect(r.ok).toBe(false);
    expect(r.conflicts[0].kind).toBe('overlap');
  });

  it('edge: back-to-back duties with exactly minRest are allowed', () => {
    const existing = [duty('t1', 'd1', 0, 8, 300)];
    // start exactly 8h after end (16:00), driving totals within cap
    const r = checkAssignment(duty('t2', 'd1', 16, 21, 240), existing);
    expect(r.ok).toBe(true);
  });

  it('edge: touching intervals (end == next start) are NOT an overlap but ARE insufficient rest', () => {
    const existing = [duty('t1', 'd1', 6, 14, 300)];
    const r = checkAssignment(duty('t2', 'd1', 14, 18, 200), existing);
    expect(r.conflicts.some((c) => c.kind === 'overlap')).toBe(false);
    expect(r.conflicts.some((c) => c.kind === 'insufficient_rest')).toBe(true);
  });

  it('reports MULTIPLE conflicts at once', () => {
    const existing = [duty('t1', 'd1', 6, 14, 480)];
    const r = checkAssignment(duty('t2', 'd1', 10, 28, 600), existing); // overlap + too long
    expect(r.conflicts.length).toBeGreaterThan(1);
  });
});
