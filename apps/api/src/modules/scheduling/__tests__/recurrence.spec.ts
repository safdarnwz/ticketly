import { describe, expect, it } from 'vitest';

import { localDate } from '@kernel';

import { datesToMaterialise, expandRecurrence, runsOn, type RecurrenceRule } from '../domain/recurrence';

const d = localDate;

describe('expandRecurrence — daily', () => {
  it('expands a simple daily service', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-05') };
    const dates = expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'));
    expect(dates).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('honours every-2-days interval', () => {
    const rule: RecurrenceRule = { frequency: 'daily', interval: 2, startDate: d('2026-03-01'), endDate: d('2026-03-07') };
    expect(expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'))).toEqual(['2026-03-01', '2026-03-03', '2026-03-05', '2026-03-07']);
  });

  it('clamps to the expansion window', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-31') };
    expect(expandRecurrence(rule, d('2026-03-10'), d('2026-03-12'))).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });
});

describe('expandRecurrence — weekly', () => {
  it('runs only on the chosen weekdays (Mon=1, Wed=3, Fri=5)', () => {
    // 2026-03-02 is a Monday.
    const rule: RecurrenceRule = { frequency: 'weekly', weekdays: [1, 3, 5], startDate: d('2026-03-02'), endDate: d('2026-03-08') };
    const dates = expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'));
    // Mon 2, Wed 4, Fri 6
    expect(dates).toEqual(['2026-03-02', '2026-03-04', '2026-03-06']);
  });

  it('honours every-2-weeks interval', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', weekdays: [1], interval: 2, startDate: d('2026-03-02'), endDate: d('2026-04-30') };
    const dates = expandRecurrence(rule, d('2026-03-01'), d('2026-04-30'));
    // Mondays every 2 weeks from Mar 2: Mar 2, Mar 16, Mar 30, Apr 13, Apr 27
    expect(dates).toEqual(['2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13', '2026-04-27']);
  });
});

describe('expandRecurrence — exceptions & additions', () => {
  it('skips exception dates (a festival cancellation)', () => {
    const rule: RecurrenceRule = {
      frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-05'),
      exceptions: [d('2026-03-03')],
    };
    expect(expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'))).toEqual(['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05']);
  });

  it('adds a one-off extra run outside the normal pattern', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly', weekdays: [7], startDate: d('2026-03-01'), endDate: d('2026-03-31'), // Sundays
      additions: [d('2026-03-04')], // an extra Wednesday
    };
    const dates = expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'));
    expect(dates).toContain('2026-03-04');
    expect(dates).toContain('2026-03-01'); // a Sunday
  });

  it('an exception wins over an addition on the same date', () => {
    const rule: RecurrenceRule = {
      frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-05'),
      exceptions: [d('2026-03-03')], additions: [d('2026-03-03')],
    };
    expect(expandRecurrence(rule, d('2026-03-01'), d('2026-03-31'))).not.toContain('2026-03-03');
  });
});

describe('datesToMaterialise & runsOn', () => {
  it('returns only the not-yet-created dates', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-05') };
    const todo = datesToMaterialise(rule, d('2026-03-01'), d('2026-03-05'), [d('2026-03-01'), d('2026-03-02')]);
    expect(todo).toEqual(['2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('runsOn answers a single date correctly', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', weekdays: [1], startDate: d('2026-03-01'), endDate: d('2026-12-31') };
    expect(runsOn(rule, d('2026-03-02'))).toBe(true); // Monday
    expect(runsOn(rule, d('2026-03-03'))).toBe(false); // Tuesday
  });
});

describe('recurrence — negative & edge', () => {
  it('rejects startDate after endDate', () => {
    expect(() => expandRecurrence({ frequency: 'daily', startDate: d('2026-03-10'), endDate: d('2026-03-01') }, d('2026-03-01'), d('2026-03-31'))).toThrow(/after endDate/);
  });

  it('rejects a weekly rule with no weekdays', () => {
    expect(() => expandRecurrence({ frequency: 'weekly', startDate: d('2026-03-01'), endDate: d('2026-03-31') }, d('2026-03-01'), d('2026-03-31'))).toThrow(/at least one weekday/);
  });

  it('rejects interval < 1 and bad weekday values', () => {
    expect(() => expandRecurrence({ frequency: 'daily', interval: 0, startDate: d('2026-03-01'), endDate: d('2026-03-31') }, d('2026-03-01'), d('2026-03-31'))).toThrow(/interval must be/);
    expect(() => expandRecurrence({ frequency: 'weekly', weekdays: [8], startDate: d('2026-03-01'), endDate: d('2026-03-31') }, d('2026-03-01'), d('2026-03-31'))).toThrow(/ISO 1..7/);
  });

  it('edge: window entirely outside the rule window yields nothing', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: d('2026-03-01'), endDate: d('2026-03-31') };
    expect(expandRecurrence(rule, d('2026-05-01'), d('2026-05-31'))).toEqual([]);
  });

  it('edge: single-day rule', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: d('2026-03-15'), endDate: d('2026-03-15') };
    expect(expandRecurrence(rule, d('2026-01-01'), d('2026-12-31'))).toEqual(['2026-03-15']);
  });
});
