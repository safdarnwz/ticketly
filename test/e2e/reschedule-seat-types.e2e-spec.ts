import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, sqlOne } from './support/flows';

/**
 * A reschedule is priced as the seats it moves to. It used to quote every seat
 * as a seater: on a sleeper bus there is no seater fare (the move was refused),
 * and on a bus with both a sleeper was priced — and the difference refunded —
 * at the seater fare.
 */
describe('reschedule prices the new seats by their type (e2e)', () => {
  let app: TestApp;
  let bookingId: string;
  let nextTrip: string;
  let sleeperSeat: string;
  let seaterSeat: string;
  const op = { as: 'operator' as const };

  const freeSeat = async (tripId: string, except: string[] = []) =>
    (
      await sqlOne<{ seat_number: string }>(
        app,
        `SELECT ts.seat_number FROM trip_seats ts
          WHERE ts.trip_id = $1 AND ts.is_bookable AND NOT ts.ladies_only AND NOT ts.accessible
            AND ts.seat_type = 'seater' AND ts.occupied_legs = 0 AND ts.blocked_legs = 0
            AND ts.seat_number <> ALL($2::text[])
            AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                             WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                               AND b.status = 'held' AND b.hold_expires_at > now())
          ORDER BY random() LIMIT 1`,
        [tripId, except],
      )
    ).seat_number;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    ({ bookingId } = await confirmedBooking(app, await freeSeat(f.tripId), {
      fullName: 'Sleeper Mover',
      age: 41,
      gender: 'male',
    }));
    const next = await sqlOne<{ id: string }>(
      app,
      `SELECT t2.id
         FROM trips t1 JOIN trips t2 ON t2.service_id = t1.service_id AND t2.journey_date > t1.journey_date
        WHERE t1.id = $1 AND t2.status = 'open' ORDER BY t2.journey_date LIMIT 1`,
      [f.tripId],
    );
    nextTrip = next.id;
    sleeperSeat = await freeSeat(nextTrip);
    seaterSeat = await freeSeat(nextTrip, [sleeperSeat]);
    // One berth on the later bus, with its own (dearer) fare.
    await sqlOne(
      app,
      `UPDATE trip_seats SET seat_type = 'sleeper' WHERE trip_id = $1 AND seat_number = $2`,
      [nextTrip, sleeperSeat],
    );
    // A berth fare next to every seater fare of the route (whichever plan prices that day).
    await sqlOne(
      app,
      `INSERT INTO fare_rules (tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor)
       SELECT fr.tenant_id, fr.fare_plan_id, fr.from_stop_id, fr.to_stop_id, 'sleeper', fr.base_fare_minor * 2
         FROM fare_rules fr JOIN fare_plans fp ON fp.id = fr.fare_plan_id
        WHERE fp.route_id = (SELECT route_id FROM trips WHERE id = $1) AND fr.seat_type = 'seater'
       ON CONFLICT DO NOTHING`,
      [nextTrip],
    );
  });

  afterAll(async () => {
    await sqlOne(
      app,
      `UPDATE trip_seats SET seat_type = 'seater' WHERE trip_id = $1 AND seat_number = $2`,
      [nextTrip, sleeperSeat],
    );
    await sqlOne(
      app,
      `DELETE FROM fare_rules WHERE seat_type = 'sleeper'
          AND fare_plan_id IN (SELECT id FROM fare_plans WHERE route_id = (SELECT route_id FROM trips WHERE id = $1))`,
      [nextTrip],
    );
    await app.close();
  });

  const quoteMove = (seat: string) =>
    app.get(
      `/bookings/${bookingId}/reschedule-quote?newTripId=${nextTrip}&newFromStopId=${app.fixtures.fromStopId}&newToStopId=${app.fixtures.toStopId}&seats=${seat}`,
      op,
    );
  const priceOf = async (seat: string, seatType: string) => {
    const q = await app.post(
      '/pricing/quote',
      {
        tripId: nextTrip,
        fromStopId: app.fixtures.fromStopId,
        toStopId: app.fixtures.toStopId,
        seatType,
        seatNumbers: [seat],
      },
      { as: 'anonymous' },
    );
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    return q.body.totalMinor as number;
  };

  it('a move to a sleeper berth costs the sleeper fare', async () => {
    const res = await quoteMove(sleeperSeat);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.newTotalMinor).toBe(await priceOf(sleeperSeat, 'sleeper'));
    expect(res.body.newTotalMinor).toBeGreaterThan(await priceOf(seaterSeat, 'seater'));
    expect(res.body.amountDueMinor).toBeGreaterThan(0);
    expect(res.body.refundMinor).toBe(0);
  });

  it('a move to a seat stays at the seat fare', async () => {
    const res = await quoteMove(seaterSeat);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.newTotalMinor).toBe(await priceOf(seaterSeat, 'seater'));
  });

  it('a seat that is not on the bus is refused', async () => {
    expect((await quoteMove('Z99')).status).toBe(422);
  });
});
