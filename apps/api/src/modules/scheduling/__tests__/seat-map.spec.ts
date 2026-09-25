import { describe, expect, it } from 'vitest';

import { SchedulingService } from '../application/services/scheduling.service';

function service(opts: { segment?: { fromSeq: number; toSeq: number } | null } = {}) {
  const trips = {
    getById: async () => ({ id: 't1', routeId: 'r1', seatLayoutId: 'l1', status: 'open' }),
    loadStops: async () => [
      { sequence: 0, stopId: 's0', canBoard: true, canAlight: false },
      { sequence: 1, stopId: 's1', canBoard: false, canAlight: true },
    ],
  };
  const inventory = {
    resolveSegment: async () =>
      opts.segment === undefined ? { fromSeq: 0, toSeq: 1 } : opts.segment,
    seatAvailability: async () => [
      {
        seatNumber: 'L1',
        seatType: 'sleeper',
        ladiesOnly: true,
        accessible: false,
        available: true,
      },
      {
        seatNumber: 'U1',
        seatType: 'sleeper',
        ladiesOnly: false,
        accessible: false,
        available: false,
      },
      {
        seatNumber: 'X9',
        seatType: 'seater',
        ladiesOnly: false,
        accessible: false,
        available: true,
      },
    ],
  };
  const layouts = {
    getById: async () => ({
      seatMap: {
        toJSON: () => ({
          decks: 2,
          rows: 6,
          columns: 3,
          seats: [
            {
              number: 'L1',
              deck: 0,
              row: 0,
              column: 0,
              rowSpan: 2,
              type: 'sleeper',
              position: 'window',
            },
            { number: 'U1', deck: 1, row: 0, column: 2, rowSpan: 2, type: 'sleeper' },
          ],
        }),
      },
    }),
  };
  const routes = { stopsWithNames: async () => [{ id: 's0', name: 'Kashmere Gate' }] };
  return new SchedulingService(
    {} as never,
    routes as never,
    {} as never,
    {} as never,
    trips as never,
    inventory as never,
    layouts as never,
  );
}

describe('SchedulingService.seatMap', () => {
  it('places every seat on the layout with its availability', async () => {
    const m = await service().seatMap('t1' as never, 's0' as never, 's1' as never);
    expect(m.layout).toEqual({ decks: 2, rows: 6, columns: 3 });
    expect(m.available).toBe(2);
    expect(m.total).toBe(3);
    expect(m.seats[0]).toMatchObject({
      seatNumber: 'L1',
      deck: 0,
      row: 0,
      column: 0,
      rowSpan: 2,
      colSpan: 1,
      position: 'window',
      ladiesOnly: true,
    });
    expect(m.seats[1]).toMatchObject({ seatNumber: 'U1', deck: 1, column: 2, available: false });
  });

  it('does not crash on a seat missing from the layout (placed at the origin)', async () => {
    const m = await service().seatMap('t1' as never, 's0' as never, 's1' as never);
    expect(m.seats[2]).toMatchObject({ seatNumber: 'X9', deck: 0, row: 0, column: 0, rowSpan: 1 });
  });

  it('rejects a boarding/dropping pair that is not a valid segment', async () => {
    await expect(
      service({ segment: null }).seatMap('t1' as never, 's1' as never, 's0' as never),
    ).rejects.toThrow(/Invalid boarding\/dropping/);
  });
});

describe('SchedulingService.tripDetail', () => {
  it('names each stop; a stop missing from the route gets null, not a crash', async () => {
    const d = await service().tripDetail('t1' as never);
    expect(d.stops.map((s) => s.name)).toEqual(['Kashmere Gate', null]);
  });
});
