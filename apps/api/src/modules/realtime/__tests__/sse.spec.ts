import { describe, it, expect } from 'vitest';

import { formatSseFrame, seatDelta } from '../domain/sse';

describe('formatSseFrame', () => {
  it('happy: emits event/id/data with a terminating blank line', () => {
    const frame = formatSseFrame({ id: '7', event: 'seat.update', data: { taken: ['A1'] } });
    expect(frame).toBe('id: 7\nevent: seat.update\ndata: {"taken":["A1"]}\n\n');
  });

  it('positive: a string payload is sent verbatim', () => {
    expect(formatSseFrame({ data: 'ping' })).toBe('data: ping\n\n');
  });

  it('edge: multi-line data gets a data: prefix per line', () => {
    expect(formatSseFrame({ data: 'line1\nline2' })).toBe('data: line1\ndata: line2\n\n');
  });

  it('positive: includes retry when provided', () => {
    expect(formatSseFrame({ data: 'x', retryMs: 3000 })).toBe('retry: 3000\ndata: x\n\n');
  });

  it('negative: undefined data throws', () => {
    // @ts-expect-error intentional
    expect(() => formatSseFrame({ event: 'x' })).toThrow();
  });
});

describe('seatDelta', () => {
  it('happy: reports taken and freed seats, sorted', () => {
    const d = seatDelta(['A1', 'A2', 'A3'], ['A2', 'A4']);
    expect(d.taken).toEqual(['A1', 'A3']);
    expect(d.freed).toEqual(['A4']);
    expect(d.changed).toBe(true);
  });

  it('edge: identical sets report no change', () => {
    const d = seatDelta(['A1', 'A2'], ['A2', 'A1']);
    expect(d.taken).toEqual([]);
    expect(d.freed).toEqual([]);
    expect(d.changed).toBe(false);
  });
});
