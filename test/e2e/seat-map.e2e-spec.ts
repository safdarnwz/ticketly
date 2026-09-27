import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

interface Seat {
  seatNumber: string;
  seatType: string;
  available: boolean;
  ladiesOnly: boolean;
  accessible: boolean;
  deck: number;
  row: number;
  column: number;
  colSpan: number;
  bookedGender: 'female' | 'male' | null;
  reservedFor: 'female' | 'male' | null;
}

/**
 * The seat map as redBus / AbhiBus show it: a price on every seat (the same
 * number a quote gives) and, when the operator turns it on, the seat beside a
 * woman kept for women (and beside a man for men) — shown on the map and
 * checked when the seat is held, on every channel; staff may override.
 */
describe('seat map: prices and who sits next to whom (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };
  const setRule = (rule: string, opts: object = op) =>
    app.put('/concessions/seat-neighbours', { rule }, opts);
  const leg = () => ({
    tripId: app.fixtures.tripId,
    fromStopId: app.fixtures.fromStopId,
    toStopId: app.fixtures.toStopId,
  });
  const map = async () =>
    (
      await app.get(
        `/scheduling/trips/${app.fixtures.tripId}/availability?from=${app.fixtures.fromStopId}&to=${app.fixtures.toStopId}`,
        { as: 'anonymous' },
      )
    ).body as { seatRule: string; seats: Seat[] };

  /** Two free seats side by side (no aisle between), neither ladies-only nor accessible. */
  const freePair = async (): Promise<[string, string]> => {
    const seats = (await map()).seats.filter((s) => s.available && !s.ladiesOnly && !s.accessible);
    for (const a of seats) {
      const b = seats.find(
        (o) =>
          o.deck === a.deck &&
          o.row === a.row &&
          o.column === a.column + a.colSpan &&
          o.seatType === a.seatType,
      );
      if (b) return [a.seatNumber, b.seatNumber];
    }
    throw new Error('no free pair of seats on the fixture trip');
  };

  const hold = (
    seat: string,
    gender: 'male' | 'female' | undefined,
    extra: object = {},
    as: 'anonymous' | 'operator' = 'anonymous',
  ) =>
    (async () => {
      const q = await app.post(
        '/pricing/quote',
        { ...leg(), seatType: 'seater', seatNumbers: [seat] },
        { as: 'anonymous' },
      );
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      return app.post(
        '/bookings/hold',
        {
          quoteId: q.body.quoteId,
          seatNumbers: [seat],
          passengers: [
            {
              seatNumber: seat,
              fullName: 'Seat Neighbour',
              age: 30,
              ...(gender ? { gender } : {}),
            },
          ],
          contactPhone: '9876500011',
          ...extra,
        },
        { as, idempotencyKey: `e2e-neigh-${seat}-${gender}-${Date.now()}-${Math.random()}` },
      );
    })();

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await setRule('off');
    await app.close();
  });

  it('prices every seat as a quote would, without issuing one', async () => {
    const res = await app.get(
      `/pricing/seat-fares?tripId=${app.fixtures.tripId}&from=${app.fixtures.fromStopId}&to=${app.fixtures.toStopId}`,
      { as: 'anonymous' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fares = res.body.seats as { seatNumber: string; seatType: string; fareMinor: number }[];
    expect(fares.length).toBeGreaterThan(0);
    const free = (await map()).seats.find((s) => s.available && s.seatType === 'seater')!;
    const q = await app.post(
      '/pricing/quote',
      { ...leg(), seatType: 'seater', seatNumbers: [free.seatNumber] },
      { as: 'anonymous' },
    );
    expect(fares.find((f) => f.seatNumber === free.seatNumber)!.fareMinor).toBe(q.body.totalMinor);
    // Bad input and a stretch the bus does not run.
    expect(
      (
        await app.get(`/pricing/seat-fares?tripId=${app.fixtures.tripId}&from=x&to=y`, {
          as: 'anonymous',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.get(
          `/pricing/seat-fares?tripId=${app.fixtures.tripId}&from=${app.fixtures.toStopId}&to=${app.fixtures.fromStopId}`,
          { as: 'anonymous' },
        )
      ).status,
    ).toBe(422);
  });

  it('only operator staff set the rule, one of off / women / both', async () => {
    expect((await setRule('men')).status).toBe(400);
    expect((await setRule('women', { as: 'customer' })).status).toBe(403);
    expect((await setRule('women', { as: 'anonymous' })).status).toBe(401);
    expect((await setRule('women')).status).toBe(200);
    expect((await app.get('/concessions', op)).body.seatNeighbours).toEqual({ rule: 'women' });
    expect((await map()).seatRule).toBe('women');
  });

  it('the seat beside a woman is for women — on the map and at booking; staff may override', async () => {
    await setRule('women');
    const [a, b] = await freePair();
    await confirmedBooking(app, a, { fullName: 'Asha Rao', age: 28, gender: 'female' });
    const after = await map();
    expect(after.seats.find((s) => s.seatNumber === a)).toMatchObject({
      available: false,
      bookedGender: 'female',
    });
    expect(after.seats.find((s) => s.seatNumber === b)).toMatchObject({
      available: true,
      reservedFor: 'female',
    });

    const man = await hold(b, 'male');
    expect(man.status).toBe(422);
    expect(man.body.detail).toMatch(/kept for women/);
    const unknown = await hold(b, undefined);
    expect(unknown.status).toBe(422);
    expect(unknown.body.detail).toMatch(/gender/);
    // Staff at the counter, with a reason, may seat him there.
    const staff = await hold(
      b,
      'male',
      {
        channel: 'backoffice',
        ladiesSeatOverrideReason: 'Husband of the passenger on the next seat',
      },
      'operator',
    );
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    const released = await app.post(
      `/bookings/${staff.body.bookingId}/release-hold`,
      { mobile: '9876500011' },
      { as: 'anonymous', idempotencyKey: `e2e-neigh-rel-${Date.now()}` },
    );
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const woman = await hold(b, 'female');
    expect(woman.status, JSON.stringify(woman.body)).toBe(201);
  });

  it("'both' also keeps the seat beside a man for men; 'off' frees every seat", async () => {
    await setRule('both');
    const [a, b] = await freePair();
    await confirmedBooking(app, a, { fullName: 'Vikram Rao', age: 35, gender: 'male' });
    expect((await map()).seats.find((s) => s.seatNumber === b)?.reservedFor).toBe('male');
    expect((await hold(b, 'female')).status).toBe(422);
    await setRule('off');
    expect((await map()).seats.find((s) => s.seatNumber === b)?.reservedFor).toBeNull();
    expect((await hold(b, 'female')).status).toBe(201);
  });
});
