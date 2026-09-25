import { describe, expect, it } from 'vitest';

import { isOpenAt, workingHoursErrors } from '../domain/working-hours';

describe('working hours', () => {
  it('validates times and days', () => {
    expect(workingHoursErrors({ mon: { open: '09:00', close: '21:00' }, sun: null })).toEqual([]);
    expect(workingHoursErrors({ mon: { open: '9:00', close: '21:00' } })).toHaveLength(1);
    expect(workingHoursErrors({ tue: { open: '10:00', close: '10:00' } })).toHaveLength(1);
    expect(workingHoursErrors({ xyz: null } as never)).toEqual(["unknown day 'xyz'"]);
  });

  it('knows when a day-time counter is open', () => {
    const h = { mon: { open: '09:00', close: '21:00' } };
    expect(isOpenAt(h, 'mon', '09:00')).toBe(true);
    expect(isOpenAt(h, 'mon', '21:00')).toBe(false);
    expect(isOpenAt(h, 'tue', '10:00')).toBe(false);
  });

  it('handles a counter open past midnight', () => {
    const h = { fri: { open: '20:00', close: '02:00' } };
    expect(isOpenAt(h, 'fri', '23:30')).toBe(true);
    expect(isOpenAt(h, 'sat', '01:59')).toBe(true);
    expect(isOpenAt(h, 'sat', '02:00')).toBe(false);
  });
});
