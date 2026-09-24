import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { type LocalDate } from '@kernel';

const MIN_LAYOVER_MINUTES = 2 * 60;
const MAX_LAYOVER_MINUTES = 24 * 60;

export interface ConnectingOption {
  connectionCityId: string;
  connectionCityName: string;
  layoverMinutes: number;
  leg1: LegSummary;
  leg2: LegSummary;
}

export interface LegSummary {
  tenantId: string;
  operatorName: string;
  tripId: string;
  routeId: string;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departsAt: string;
  arrivesAt: string;
  baseFareMinor: number;
  availableSeats: number;
}

/**
 * Finds connecting (multi-leg, cross-operator) journeys when no single
 * operator runs origin -> destination directly. Genuinely cross-tenant:
 * routes/trips/stops are all tenant-scoped (each operator has their OWN
 * "Kolkata" stop row), so matching "the same city" is done on
 * cities.id — the one thing both operators' rows actually share — and
 * this whole search runs bypassRls, since it must see every operator's
 * routes to find a connection at all. Only READS cross-tenant; nothing
 * here writes, and no fare/passenger detail is exposed beyond what a
 * normal one-leg search already shows for each leg.
 */
@Injectable()
export class ConnectingSearchService {
  constructor(private readonly uow: UnitOfWork) {}

  async search(originCityId: string, destinationCityId: string, date: LocalDate): Promise<ConnectingOption[]> {
    if (originCityId === destinationCityId) return [];

    return this.uow.run({ name: 'connections.search', bypassRls: true }, async (scope) => {
      // Candidate route PAIRS: leg1 starts at the requested origin, leg2
      // ends at the requested destination, and leg1's destination city is
      // the SAME city as leg2's origin — regardless of which tenant owns
      // either route. A route whose own origin==destination (a loop) can
      // never legitimately appear as a leg1/leg2 candidate here since
      // origin_city_id <> dest_city_id is already enforced when routes are
      // created, so no extra guard is needed for that.
      const pairs = await scope.client.query<{
        leg1_tenant_id: string; leg1_route_id: string; leg1_operator: string;
        leg2_tenant_id: string; leg2_route_id: string; leg2_operator: string;
        connection_city_id: string; connection_city_name: string;
      }>(
        `SELECT r1.tenant_id AS leg1_tenant_id, r1.id AS leg1_route_id, t1.display_name AS leg1_operator,
                r2.tenant_id AS leg2_tenant_id, r2.id AS leg2_route_id, t2.display_name AS leg2_operator,
                r1.dest_city_id AS connection_city_id, c.name AS connection_city_name
           FROM routes r1
           JOIN tenants t1 ON t1.id = r1.tenant_id AND t1.status = 'active'
           JOIN routes r2 ON r2.origin_city_id = r1.dest_city_id AND r2.dest_city_id = $2
           JOIN tenants t2 ON t2.id = r2.tenant_id AND t2.status = 'active'
           JOIN cities c ON c.id = r1.dest_city_id
          WHERE r1.origin_city_id = $1 AND r1.status = 'published' AND r2.status = 'published'
            -- A same-tenant "direct-via-one-operator" pair is still a
            -- legitimate connecting option (an operator's own two
            -- services meeting at a hub they both serve) — tenant equality
            -- is NOT excluded here on purpose.
          LIMIT 200`,
        [originCityId, destinationCityId],
      );
      if (pairs.rows.length === 0) return [];

      const options: ConnectingOption[] = [];

      for (const pair of pairs.rows) {
        // Leg1 trips on the requested date. Leg2 trips are searched across
        // the requested date AND the next day — a layover can legitimately
        // cross midnight (e.g. leg1 arrives 11 PM, leg2 departs 3 AM the
        // next day is a perfectly normal 4h connection), so restricting
        // leg2 to the SAME calendar date as leg1 would silently drop valid
        // overnight connections.
        const leg1Trips = await scope.client.query<{
          id: string; departs_at: Date; arrives_at: Date; total_seats: number; vehicle_id: string | null;
        }>(
          `SELECT id, departs_at, arrives_at, total_seats, vehicle_id FROM trips
            WHERE tenant_id = $1 AND route_id = $2 AND journey_date = $3 AND status = 'open'`,
          [pair.leg1_tenant_id, pair.leg1_route_id, date],
        );
        if (leg1Trips.rows.length === 0) continue;

        const leg2Trips = await scope.client.query<{
          id: string; departs_at: Date; arrives_at: Date; total_seats: number; vehicle_id: string | null;
        }>(
          `SELECT id, departs_at, arrives_at, total_seats, vehicle_id FROM trips
            WHERE tenant_id = $1 AND route_id = $2 AND journey_date IN ($3::date, ($3::date + interval '1 day')::date) AND status = 'open'`,
          [pair.leg2_tenant_id, pair.leg2_route_id, date],
        );
        if (leg2Trips.rows.length === 0) continue;

        for (const t1 of leg1Trips.rows) {
          for (const t2 of leg2Trips.rows) {
            const layoverMinutes = Math.round((t2.departs_at.getTime() - t1.arrives_at.getTime()) / 60_000);
            if (layoverMinutes < MIN_LAYOVER_MINUTES || layoverMinutes > MAX_LAYOVER_MINUTES) continue;

            const leg1Detail = await this.legDetail(scope.client, pair.leg1_tenant_id, pair.leg1_route_id, t1);
            const leg2Detail = await this.legDetail(scope.client, pair.leg2_tenant_id, pair.leg2_route_id, t2);
            if (!leg1Detail || !leg2Detail) continue;
            if (leg1Detail.availableSeats === 0 || leg2Detail.availableSeats === 0) continue;

            options.push({
              connectionCityId: pair.connection_city_id,
              connectionCityName: pair.connection_city_name,
              layoverMinutes,
              leg1: { ...leg1Detail, operatorName: pair.leg1_operator },
              leg2: { ...leg2Detail, operatorName: pair.leg2_operator },
            });
          }
        }
      }

      // Shortest total journey time first — the ordering a passenger
      // actually cares about, not insertion order off two nested loops.
      return options.sort((a, b) =>
        (new Date(a.leg2.arrivesAt).getTime() - new Date(a.leg1.departsAt).getTime()) -
        (new Date(b.leg2.arrivesAt).getTime() - new Date(b.leg1.departsAt).getTime()));
    });
  }

  private async legDetail(
    client: any,
    tenantId: string, routeId: string,
    trip: { id: string; departs_at: Date; arrives_at: Date; total_seats: number },
  ): Promise<Omit<LegSummary, 'operatorName'> | null> {
    const stopRow = await client.query<{ from_stop_id: string; from_stop_name: string; to_stop_id: string; to_stop_name: string }>(
      `SELECT frs.stop_id AS from_stop_id, fs.name AS from_stop_name, trs.stop_id AS to_stop_id, ts.name AS to_stop_name
         FROM route_stops frs
         JOIN stops fs ON fs.id = frs.stop_id
         JOIN route_stops trs ON trs.route_id = frs.route_id AND trs.sequence = (SELECT max(sequence) FROM route_stops WHERE route_id = frs.route_id)
         JOIN stops ts ON ts.id = trs.stop_id
        WHERE frs.route_id = $1 AND frs.sequence = 1`,
      [routeId],
    );
    const stops = stopRow.rows[0];
    if (!stops) return null;

    const fareRow = await client.query<{ base_fare_minor: number }>(
      `SELECT fr.base_fare_minor FROM fare_rules fr
         JOIN fare_plans fp ON fp.id = fr.fare_plan_id AND fp.route_id = $1 AND fp.status = 'active'
        WHERE fr.tenant_id = $2 AND fr.seat_type = 'seater'
        ORDER BY (fr.from_stop_id IS NULL), (fr.to_stop_id IS NULL) LIMIT 1`,
      [routeId, tenantId],
    );

    const seatCountRow = await client.query<{ available: number }>(
      `SELECT count(*)::int AS available FROM trip_seats
        WHERE trip_id = $1 AND is_bookable = true AND occupied_legs = 0 AND blocked_legs = 0`,
      [trip.id],
    );

    return {
      tenantId, tripId: trip.id, routeId,
      fromStopId: stops.from_stop_id, fromStopName: stops.from_stop_name,
      toStopId: stops.to_stop_id, toStopName: stops.to_stop_name,
      departsAt: trip.departs_at.toISOString(), arrivesAt: trip.arrives_at.toISOString(),
      baseFareMinor: fareRow.rows[0]?.base_fare_minor ?? 0,
      availableSeats: seatCountRow.rows[0]?.available ?? 0,
    };
  }
}
