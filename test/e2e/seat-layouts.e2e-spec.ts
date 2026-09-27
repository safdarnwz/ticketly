import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { sqlOne } from './support/flows';

type Seat = {
  number: string;
  deck: 0 | 1;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
  type: string;
};
type Fixture = {
  kind: string;
  deck: 0 | 1;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
};
interface Layout {
  decks: number;
  rows: number;
  columns: number;
  deckGrids?: { rows: number; columns: number }[];
  seats: Seat[];
  fixtures?: Fixture[];
}

/**
 * The operator draws each bus once: every deck with its own rows and
 * columns, seats and berths anywhere, and the driver, doors, washroom and
 * stairs where they really are. The seat map every screen reads carries it
 * all; a layout already selling trips may be rearranged but not renumbered.
 */
describe('seat layouts: decks of their own size, fixtures, locked seat numbers (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };
  const run = Date.now().toString().slice(-6);

  /** 2+2 seats downstairs with door, driver and stairs; 2+1 berths upstairs on a narrower grid. */
  const combo = (): Layout => ({
    decks: 2,
    rows: 6,
    columns: 5,
    deckGrids: [
      { rows: 6, columns: 5 },
      { rows: 4, columns: 4 },
    ],
    seats: [
      { number: '1', deck: 0, row: 1, column: 3, type: 'seater' },
      { number: '2', deck: 0, row: 1, column: 4, type: 'seater' },
      { number: '3', deck: 0, row: 2, column: 0, type: 'seater' },
      { number: '4', deck: 0, row: 2, column: 1, type: 'seater' },
      { number: 'U1', deck: 1, row: 0, column: 0, rowSpan: 2, type: 'sleeper' },
      { number: 'U2', deck: 1, row: 0, column: 2, rowSpan: 2, type: 'sleeper' },
      { number: 'U3', deck: 1, row: 3, column: 0, colSpan: 2, type: 'sleeper' },
    ],
    fixtures: [
      { kind: 'door', deck: 0, row: 0, column: 0 },
      { kind: 'driver', deck: 0, row: 0, column: 4 },
      { kind: 'staircase', deck: 0, row: 1, column: 0 },
      { kind: 'washroom', deck: 0, row: 4, column: 3, rowSpan: 2, colSpan: 2 },
    ],
  });
  const create = (layout: Layout, name = `E2E combo ${run}`, opts: object = op) =>
    app.post('/master-data/seat-layouts', { name, layout }, opts);

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves each deck with its own rows and columns and the fixtures where they are', async () => {
    const made = await create(combo());
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.summary).toMatchObject({ totalSeats: 7, seater: 4, sleeper: 3, washrooms: 1 });
    const back = await app.get(`/master-data/seat-layouts/${made.body.id}`, op);
    expect(back.body.seatMap.deckGrids).toEqual(combo().deckGrids);
    expect(back.body.seatMap.fixtures.map((f: Fixture) => f.kind)).toEqual([
      'door',
      'driver',
      'staircase',
      'washroom',
    ]);

    // Not in use: renumbering freely is fine.
    const renamed = combo();
    renamed.seats[0].number = '1A';
    const upd = await app.patch(
      `/master-data/seat-layouts/${made.body.id}`,
      { name: `E2E combo ${run}`, layout: renamed },
      op,
    );
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await app.get(`/master-data/seat-layouts/${made.body.id}/usage`, op)).body).toEqual({
      vehicleCount: 0,
      upcomingTrips: 0,
    });
  });

  it('refuses what cannot be built, with the reason', async () => {
    const reason = async (layout: Layout) => {
      const r = await create(layout, `E2E bad ${run} ${Math.random()}`);
      expect(r.status).toBe(422);
      return r.body.detail as string;
    };
    const onSeat = combo();
    onSeat.fixtures!.push({ kind: 'washroom', deck: 0, row: 1, column: 3 });
    expect(await reason(onSeat)).toMatch(/washroom overlaps seat '1'/);
    const wide = combo();
    wide.seats.push({ number: 'U9', deck: 1, row: 2, column: 4, type: 'sleeper' }); // upper deck is 4 wide
    expect(await reason(wide)).toMatch(/overflows the grid horizontally/);
    const twin = combo();
    twin.seats[1].number = 'u1';
    expect(await reason(twin)).toMatch(/Duplicate seat number/);
    const single: Layout = {
      decks: 1,
      rows: 3,
      columns: 3,
      seats: [{ number: '1', deck: 0, row: 0, column: 0, type: 'seater' }],
      fixtures: [{ kind: 'staircase', deck: 0, row: 1, column: 1 }],
    };
    expect(await reason(single)).toMatch(/staircase needs an upper deck/);
    const drivers = combo();
    drivers.fixtures!.push({ kind: 'driver', deck: 0, row: 3, column: 4 });
    expect(await reason(drivers)).toMatch(/one driver/);
    // Unknown fixture and a missing deck grid never reach the model.
    const odd = combo() as unknown as { fixtures: { kind: string }[] };
    odd.fixtures[0].kind = 'jacuzzi';
    expect((await create(odd as unknown as Layout, `E2E odd ${run}`)).status).toBe(400);
    expect(
      (await create({ ...combo(), deckGrids: [{ rows: 6, columns: 5 }] }, `E2E grid ${run}`))
        .status,
    ).toBe(422);
  });

  it('only operator staff with layout rights build layouts', async () => {
    expect((await create(combo(), `E2E cust ${run}`, { as: 'customer' })).status).toBe(403);
    expect((await create(combo(), `E2E anon ${run}`, { as: 'anonymous' })).status).toBe(401);
  });

  it('a layout selling trips: seats and fixtures may move, seat numbers and types may not; the seat map shows it', async () => {
    const { seat_layout_id: id } = await sqlOne<{ seat_layout_id: string }>(
      app,
      'SELECT seat_layout_id FROM trips WHERE id = $1',
      [app.fixtures.tripId],
    );
    const current = (await app.get(`/master-data/seat-layouts/${id}`, op)).body as {
      name: string;
      seatMap: Layout & { summary?: unknown };
    };
    const { summary: _s, ...original } = current.seatMap;
    expect(
      (await app.get(`/master-data/seat-layouts/${id}/usage`, op)).body.upcomingTrips,
    ).toBeGreaterThan(0);

    // An empty cell on the lower deck for a washroom.
    const taken = new Set<string>();
    for (const x of [...original.seats, ...(original.fixtures ?? [])])
      if (x.deck === 0)
        for (let r = x.row; r < x.row + (x.rowSpan ?? 1); r++)
          for (let c = x.column; c < x.column + (x.colSpan ?? 1); c++) taken.add(`${r}:${c}`);
    const rows = original.deckGrids?.[0].rows ?? original.rows;
    const cols = original.deckGrids?.[0].columns ?? original.columns;
    let free: { row: number; column: number } | undefined;
    for (let r = 0; r < rows && !free; r++)
      for (let c = 0; c < cols && !free; c++)
        if (!taken.has(`${r}:${c}`)) free = { row: r, column: c };
    expect(free, 'an empty cell (the aisle) on the fixture bus').toBeDefined();

    try {
      const moved = {
        ...original,
        fixtures: [...(original.fixtures ?? []), { kind: 'washroom', deck: 0 as const, ...free! }],
      };
      const ok = await app.patch(
        `/master-data/seat-layouts/${id}`,
        { name: current.name, layout: moved },
        op,
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const map = await app.get(
        `/scheduling/trips/${app.fixtures.tripId}/availability?from=${app.fixtures.fromStopId}&to=${app.fixtures.toStopId}`,
        { as: 'anonymous' },
      );
      expect(map.body.layout.fixtures).toContainEqual({ kind: 'washroom', deck: 0, ...free! });
      expect(map.body.layout.grids).toHaveLength(original.decks);

      const renumbered = {
        ...original,
        seats: original.seats.map((s, i) => (i === 0 ? { ...s, number: 'Z9' } : s)),
      };
      const no = await app.patch(
        `/master-data/seat-layouts/${id}`,
        { name: current.name, layout: renumbered },
        op,
      );
      expect(no.status).toBe(409);
      expect(no.body.detail).toMatch(
        /upcoming trip\(s\) sell seats from this layout.*duplicate the layout/,
      );
      const retyped = {
        ...original,
        seats: original.seats.map((s, i) =>
          i === 0 && s.type === 'seater' ? { ...s, type: 'semi_sleeper' } : s,
        ),
      };
      if (original.seats[0].type === 'seater')
        expect(
          (
            await app.patch(
              `/master-data/seat-layouts/${id}`,
              { name: current.name, layout: retyped },
              op,
            )
          ).status,
        ).toBe(409);
    } finally {
      await app.patch(
        `/master-data/seat-layouts/${id}`,
        { name: current.name, layout: original },
        op,
      );
    }
  });
});
