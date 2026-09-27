import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId } from '@kernel';

export interface TripForDetails {
  id: string;
  routeId: string;
  serviceId: string | null;
  vehicleId: string | null;
  seatLayoutId: string;
  departsAt: Date;
  arrivesAt: Date;
  status: string;
}

export interface BusRow {
  id: string;
  registrationNo: string;
  make: string | null;
  model: string | null;
  manufactureYear: number | null;
  typeName: string | null;
  isAc: boolean;
  hasGpsDevice: boolean;
  verified: boolean;
}

export interface StopRow {
  sequence: number;
  stopId: string;
  name: string;
  city: string | null;
  landmark: string | null;
  address: string | null;
  arrivesAt: Date;
  departsAt: Date;
  canBoard: boolean;
  canAlight: boolean;
  distanceM: number;
}

/**
 * The read model behind a trip's "bus details" (the tabs under the seat map):
 * the trip, the bus on it, every stop with its landmark, the operator's
 * policies and how many drivers take turns. Everything is the operator's own
 * data, read in its tenant scope.
 */
@Injectable()
export class BusDetailsRepository {
  constructor(private readonly db: DatabaseService) {}

  trip(tripId: string): Promise<TripForDetails | null> {
    return this.db.queryOne<TripForDetails>(
      `SELECT id, route_id AS "routeId", service_id AS "serviceId", vehicle_id AS "vehicleId",
              seat_layout_id AS "seatLayoutId", departs_at AS "departsAt", arrives_at AS "arrivesAt",
              status::text AS status
         FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'busDetails.trip' },
    );
  }

  bus(vehicleId: string): Promise<BusRow | null> {
    return this.db.queryOne<BusRow>(
      `SELECT v.id, v.registration_no AS "registrationNo", v.make, v.model,
              v.manufacture_year AS "manufactureYear", vt.name AS "typeName",
              coalesce(v.has_ac, vt.is_ac, false) AS "isAc",
              (v.gps_device_id IS NOT NULL) AS "hasGpsDevice",
              (v.verification_status = 'approved') AS verified
         FROM vehicles v LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        WHERE v.tenant_id = $1 AND v.id = $2`,
      [requireTenantId(), vehicleId],
      { name: 'busDetails.bus' },
    );
  }

  stops(tripId: string): Promise<StopRow[]> {
    return this.db.query<StopRow>(
      `SELECT ts.sequence, ts.stop_id AS "stopId", s.name, c.name AS city, s.landmark, s.address,
              ts.arrives_at AS "arrivesAt", ts.departs_at AS "departsAt",
              ts.can_board AS "canBoard", ts.can_alight AS "canAlight",
              coalesce(rs.distance_from_origin_m, 0) AS "distanceM"
         FROM trip_stops ts
         JOIN trips t ON t.id = ts.trip_id
         JOIN stops s ON s.id = ts.stop_id
         LEFT JOIN cities c ON c.id = s.city_id
         LEFT JOIN route_stops rs ON rs.route_id = t.route_id AND rs.sequence = ts.sequence
        WHERE ts.tenant_id = $1 AND ts.trip_id = $2
        ORDER BY ts.sequence`,
      [requireTenantId(), tripId],
      { name: 'busDetails.stops' },
    );
  }

  /** The operator's published rules: refunds, luggage, travel policies, child ages. */
  async policies(): Promise<{
    operatorName: string;
    refundPolicy: unknown;
    luggage: unknown;
    travel: unknown;
    adultAge: number | null;
    infantMaxAge: number | null;
  }> {
    const row = await this.db.queryOne<{
      name: string;
      refund_policy: unknown;
      luggage: unknown;
      travel: unknown;
      adult_age: number | null;
      infant_max_age: number | null;
    }>(
      `SELECT coalesce(t.display_name, t.legal_name, t.slug) AS name, t.refund_policy,
              t.settings->'luggage' AS luggage, t.settings->'travelPolicies' AS travel,
              pp.adult_age, pp.infant_max_age
         FROM tenants t LEFT JOIN passenger_policies pp ON pp.tenant_id = t.id
        WHERE t.id = $1`,
      [requireTenantId()],
      { name: 'busDetails.policies' },
    );
    return {
      operatorName: row?.name ?? 'Operator',
      refundPolicy: row?.refund_policy ?? null,
      luggage: row?.luggage ?? null,
      travel: row?.travel ?? null,
      adultAge: row?.adult_age ?? null,
      infantMaxAge: row?.infant_max_age ?? null,
    };
  }

  /** Drivers taking turns on the trip (names and phones stay private until the 4-hour reminder). */
  async driverCount(tripId: string): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM crew_duties d JOIN crew c ON c.id = d.crew_id
        WHERE d.tenant_id = $1 AND d.trip_id = $2 AND d.status = 'assigned'
          AND d.attendance <> 'absent' AND c.role = 'driver'`,
      [requireTenantId(), tripId],
      { name: 'busDetails.drivers' },
    );
    return Number(row?.n ?? 0);
  }
}
