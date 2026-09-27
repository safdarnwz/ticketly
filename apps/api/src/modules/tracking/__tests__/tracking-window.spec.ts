import { describe, expect, it } from 'vitest';

import {
  gpsProblem,
  trackingMessage,
  trackingPhase,
  trackingStartsAt,
} from '../domain/tracking-window';

const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00Z`);
// A bus leaving 16:00 and due at 21:30.
const trip = { departsAt: at('16:00'), arrivesAt: at('21:30'), status: 'open' };
const t = (d: Date) => d.toISOString().slice(11, 16);

describe('tracking window', () => {
  it('opens one hour before departure', () => {
    expect(trackingStartsAt(trip)).toEqual(at('15:00'));
    expect(trackingPhase(trip, at('13:59'))).toBe('too_early'); // two hours before
    expect(trackingPhase(trip, at('14:59'))).toBe('too_early');
    expect(trackingPhase(trip, at('15:00'))).toBe('live');
    expect(trackingPhase(trip, at('17:00'))).toBe('live');
  });

  it('stays live for a late bus still on the road, ends when the crew closes the trip', () => {
    expect(trackingPhase({ ...trip, status: 'departed' }, at('23:59'))).toBe('live');
    expect(
      trackingPhase({ ...trip, status: 'closed', actualDepartedAt: at('16:05') }, at('21:40')),
    ).toBe('ended');
  });

  it('a bus that never reported ends an hour after its arrival time; a cancelled one says so', () => {
    expect(trackingPhase(trip, at('22:29'))).toBe('live');
    expect(trackingPhase(trip, at('22:31'))).toBe('ended');
    expect(trackingPhase({ ...trip, status: 'cancelled' }, at('15:30'))).toBe('cancelled');
  });

  it('explains itself before and after', () => {
    expect(trackingMessage('too_early', { startsAt: '8:30 pm', departsAt: '9:30 pm' })).toMatch(
      /starts at 8:30 pm.*9:30 pm/,
    );
    expect(trackingMessage('ended', { startsAt: '', departsAt: '', endedAt: '3:05 am' })).toMatch(
      /ended at 3:05 am/,
    );
    expect(trackingMessage('cancelled', { startsAt: '', departsAt: '' })).toMatch(/cancelled/);
  });

  it('takes GPS from the crew phone only inside the window', () => {
    expect(gpsProblem(trip, at('14:00'), t)).toMatch(/starts at 15:00/);
    expect(gpsProblem(trip, at('15:10'), t)).toBeNull();
    expect(
      gpsProblem({ ...trip, status: 'closed', actualDepartedAt: at('16:00') }, at('21:00'), t),
    ).toMatch(/ended/);
  });
});
