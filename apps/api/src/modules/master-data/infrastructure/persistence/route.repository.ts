import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService, registerConstraintMessages, UnitOfWork } from '@database';
import { gstCodeOfState, stateFromGstin } from '../../domain/gst-state-codes';
import {
  minuteOfDay,
  newId,
  NotFoundError,
  requireTenantId,
  type CityId,
  type RouteId,
  type StopId,
  type TenantId,
} from '@kernel';

import { RoutePath, type RouteStopInput } from '../../routes/domain/route-path';
import { type RouteStatus } from '../../domain/route';

export type { RouteStatus };

registerConstraintMessages({ routes_tenant_id_code_key: 'A route with this code already exists' });

export interface RouteStopRef {
  id: StopId;
  name: string;
  sequence: number;
  /** Extra per seat (paise) for boarding / getting off here; 0 = none. */
  boardChargeMinor: number;
  dropChargeMinor: number;
}

/** One stop's pickup / drop charges on a route, with what the stop allows. */
export interface PointCharge {
  stopId: StopId;
  name: string;
  sequence: number;
  canBoard: boolean;
  canAlight: boolean;
  boardChargeMinor: number;
  dropChargeMinor: number;
}

export interface RouteRecord {
  id: RouteId;
  code: string;
  name: string;
  originCityId: CityId;
  destCityId: CityId;
  status: RouteStatus;
  /** The service origin-departure time this path was authored against. */
  path: RoutePath;
}

/**
 * Route repository. A route + its stops are always read and written together
 * (the path is meaningless without its stops), so the two tables are handled as
 * one aggregate here. Published routes are cache-backed because scheduling
 * (Part 5) reads them for every trip it materialises.
 */
@Injectable()
export class RouteRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Persist a route and its stops. `startTime` is HH:MM origin departure. */
  async create(input: {
    code: string;
    name: string;
    originCityId: CityId;
    destCityId: CityId;
    startTime: string;
    stops: RouteStopInput[];
  }): Promise<RouteId> {
    // Validate the whole path BEFORE any write — an invalid route never persists.
    const path = RoutePath.create(minuteOfDay(input.startTime), input.stops);
    const id = newId() as RouteId;
    const tenantId = requireTenantId();

    // route + stops written together; caller wraps in a unit of work.
    await this.db.execute_(
      `INSERT INTO routes (id, tenant_id, code, name, origin_city_id, dest_city_id, total_distance_m, total_duration_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        tenantId,
        input.code.trim(),
        input.name.trim(),
        input.originCityId,
        input.destCityId,
        path.totalDistanceM,
        path.totalDurationMin,
      ],
      { name: 'route.create', primary: true },
    );

    // Bulk-insert the stops in one statement (10 columns per row).
    const params: unknown[] = [];
    const rowSql = input.stops.map((s, i) => {
      const b = i * 10;
      params.push(
        newId(),
        tenantId,
        id,
        s.stopId,
        s.sequence,
        s.distanceFromOriginM,
        s.departOffsetMin,
        s.dwellMin ?? 0,
        s.canBoard ?? true,
        s.canAlight ?? true,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
    });
    await this.db.execute_(
      `INSERT INTO route_stops
         (id, tenant_id, route_id, stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight)
       VALUES ${rowSql.join(',')}`,
      params,
      { name: 'route.createStops', primary: true },
    );
    return id;
  }

  /** Routes counting towards the plan quota: every one not archived. */
  async countActive(): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM routes WHERE tenant_id = $1 AND deleted_at IS NULL AND status <> 'archived'`,
      [requireTenantId()],
      { name: 'route.countActive', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async findById(id: RouteId): Promise<RouteRecord | null> {
    const route = await this.db.queryOne<RouteRow>(
      `SELECT id, code, name, origin_city_id, dest_city_id, status FROM routes
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'route.findById' },
    );
    if (!route) return null;

    const stops = await this.db.query<StopRow>(
      `SELECT stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight
         FROM route_stops WHERE route_id = $1 ORDER BY sequence`,
      [id],
      { name: 'route.findStops' },
    );

    // The service start-time is derived from the first stop's absolute clock:
    // route_stops store offsets, and the origin's clock is the anchor. We store
    // the origin clock in the route via total fields; here we reconstruct using
    // 00:00 anchor + offsets, which is sufficient for segment math (durations
    // and offsets are anchor-independent). Scheduling supplies the real anchor.
    const path = RoutePath.create(
      minuteOfDay('00:00'),
      stops.map((s) => ({
        stopId: s.stop_id,
        sequence: s.sequence,
        distanceFromOriginM: s.distance_from_origin_m,
        departOffsetMin: s.depart_offset_min,
        dwellMin: s.dwell_min,
        canBoard: s.can_board,
        canAlight: s.can_alight,
      })),
    );

    return {
      id: route.id,
      code: route.code,
      name: route.name,
      originCityId: route.origin_city_id,
      destCityId: route.dest_city_id,
      status: route.status,
      path,
    };
  }

  async getById(id: RouteId): Promise<RouteRecord> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Route', id);
    return found;
  }

  async setStatus(id: RouteId, status: RouteStatus): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE routes SET status = $3, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, status],
      { name: 'route.setStatus', primary: true },
    );
    if (affected === 0) throw new NotFoundError('Route', id);
    await this.cache.invalidate(id, CacheNamespace.ROUTE);
    await this.cache.invalidate(`stops:${id}`, CacheNamespace.ROUTE);
  }

  /**
   * The route's stops in order, with names — cached, because search reads it
   * for every route it returns. Invalidated with the route (see setStatus).
   */
  async stopsWithNames(routeId: RouteId): Promise<RouteStopRef[]> {
    return this.cache.getOrLoad(
      `stops:${routeId}`,
      { namespace: CacheNamespace.ROUTE, ttlSeconds: CacheTtl.MASTER_DATA },
      () =>
        this.db.query<RouteStopRef>(
          `SELECT rs.stop_id AS id, s.name, rs.sequence,
                  rs.board_charge_minor AS "boardChargeMinor", rs.drop_charge_minor AS "dropChargeMinor"
             FROM route_stops rs JOIN stops s ON s.id = rs.stop_id
            WHERE rs.route_id = $1 ORDER BY rs.sequence`,
          [routeId],
          { name: 'route.stopsWithNames' },
        ),
    );
  }

  /** Published routes connecting an origin city to a destination city (for search). */
  async findPublishedByOd(originCityId: CityId, destCityId: CityId): Promise<RouteId[]> {
    const rows = await this.db.query<{ id: RouteId }>(
      `SELECT id FROM routes
        WHERE tenant_id = $1 AND origin_city_id = $2 AND dest_city_id = $3
          AND status = 'published' AND deleted_at IS NULL`,
      [requireTenantId(), originCityId, destCityId],
      { name: 'route.findPublishedByOd' },
    );
    return rows.map((r) => r.id);
  }

  async list(
    status?: RouteStatus,
  ): Promise<{ id: RouteId; code: string; name: string; status: RouteStatus }[]> {
    const rows = await this.db.query<{
      id: RouteId;
      code: string;
      name: string;
      status: RouteStatus;
    }>(
      `SELECT id, code, name, status FROM routes
        WHERE tenant_id = $1 AND deleted_at IS NULL ${status ? 'AND status = $2' : ''}
        ORDER BY code`,
      status ? [requireTenantId(), status] : [requireTenantId()],
      { name: 'route.list' },
    );
    return rows;
  }

  /**
   * Whether a route's origin and destination cities are in DIFFERENT states —
   * the GST place-of-supply test that decides IGST vs CGST+SGST (see
   * PricingEngine.computeTaxes). Cached: a route's cities never change more
   * often than the route itself, which is already cache-invalidated on edit.
   */
  /**
   * @remarks CORRECT GST rule (IGST Act s.12(9) for passenger transport):
   * interState compares the OPERATOR'S OWN registered state (from their
   * GSTIN) against the trip's ORIGIN state (place of supply = point of
   * embarkation) — never the trip's origin-vs-destination, which has no
   * bearing on GST liability at all. A Delhi-registered operator running
   * a Delhi -> Gurgaon route owes CGST+SGST (both Delhi), even though
   * origin and destination are different states; a Delhi-registered
   * operator running an intra-Karnataka Bangalore -> Mysore route owes
   * IGST (Delhi vs Karnataka), even though origin and destination are
   * the SAME state.
   *
   * Fetches the operator's own GSTIN directly here (a single indexed
   * lookup on the current tenant) rather than requiring every one of
   * this method's several callers (pricing quote, search listings,
   * invoice generation) to separately source and pass it through — this
   * is also what avoids a circular module dependency PricingModule
   * explicitly cannot take on (TenancyModule -> BookingModule ->
   * PricingModule), since the tenants table is queried directly instead
   * of via TenantRepository/TenancyModule.
   *
   * Falls back to failing toward IGST (the higher-scrutiny path) when
   * the operator's GSTIN state can't be determined, rather than silently
   * assuming intra-state on missing data.
   */
  /**
   * Place of supply of a passenger-transport service: the state where the
   * journey starts (IGST Act s.12(9)) — the route's origin, the same state
   * isInterState compares with the operator's own.
   */
  async placeOfSupply(
    routeId: RouteId,
  ): Promise<{ stateName: string; stateCode: string; gstCode: string | null } | null> {
    const row = await this.db.queryOne<{ name: string; code: string }>(
      `SELECT s.name, s.code
         FROM routes r
         JOIN cities o ON o.id = r.origin_city_id
         JOIN states s ON s.id = o.state_id
        WHERE r.id = $1`,
      [routeId],
      { name: 'route.placeOfSupply', primary: true },
    );
    return row
      ? { stateName: row.name, stateCode: row.code, gstCode: gstCodeOfState(row.code) }
      : null;
  }

  async isInterState(routeId: RouteId): Promise<boolean> {
    const row = await this.db.queryOne<{
      origin_state_code: string;
      operator_gstin: string | null;
    }>(
      `SELECT s.code AS origin_state_code, t.gstin AS operator_gstin
         FROM routes r
         JOIN cities o ON o.id = r.origin_city_id
         JOIN states s ON s.id = o.state_id
         JOIN tenants t ON t.id = r.tenant_id
        WHERE r.id = $1`,
      [routeId],
      { name: 'route.isInterState', primary: true },
    );
    const operatorState = stateFromGstin(row?.operator_gstin);
    if (!operatorState || !row) return true;
    return operatorState !== row.origin_state_code;
  }

  /**
   * Active operators with a published route between two cities — across all
   * tenants (search fans out to each), so RLS is bypassed; returns ids only.
   */
  tenantsServingOd(originCityId: CityId, destCityId: CityId): Promise<TenantId[]> {
    return this.uow.run(
      { name: 'route.tenantsServingOd', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<{ tenant_id: TenantId }>(
          `SELECT DISTINCT r.tenant_id
             FROM routes r
             JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
            WHERE r.origin_city_id = $1 AND r.dest_city_id = $2
              AND r.status = 'published' AND r.deleted_at IS NULL`,
          [originCityId, destCityId],
        );
        return r.rows.map((x) => x.tenant_id);
      },
    );
  }

  /** Every stop of the route with its pickup / drop charge (the operator's own route only). */
  async pointCharges(routeId: RouteId): Promise<PointCharge[]> {
    return this.db.query<PointCharge>(
      `SELECT rs.stop_id AS "stopId", s.name, rs.sequence, rs.can_board AS "canBoard", rs.can_alight AS "canAlight",
              rs.board_charge_minor AS "boardChargeMinor", rs.drop_charge_minor AS "dropChargeMinor"
         FROM route_stops rs JOIN stops s ON s.id = rs.stop_id
        WHERE rs.tenant_id = $1 AND rs.route_id = $2 ORDER BY rs.sequence`,
      [requireTenantId(), routeId],
      { name: 'route.pointCharges', primary: true },
    );
  }

  /** Set the charges of the stops given (others unchanged) and drop the cached stop list. */
  async setPointCharges(
    routeId: RouteId,
    items: { stopId: StopId; boardChargeMinor: number; dropChargeMinor: number }[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.db.execute_(
      `UPDATE route_stops rs
          SET board_charge_minor = x.board, drop_charge_minor = x.drop
         FROM unnest($3::uuid[], $4::int[], $5::int[]) AS x(stop_id, board, drop)
        WHERE rs.tenant_id = $1 AND rs.route_id = $2 AND rs.stop_id = x.stop_id`,
      [
        requireTenantId(),
        routeId,
        items.map((i) => i.stopId),
        items.map((i) => i.boardChargeMinor),
        items.map((i) => i.dropChargeMinor),
      ],
      { name: 'route.setPointCharges', primary: true },
    );
    await this.cache.invalidate(`stops:${routeId}`, CacheNamespace.ROUTE);
  }

  /** A duplicated route starts with the same pickup / drop charges. */
  async copyPointCharges(fromRouteId: RouteId, toRouteId: RouteId): Promise<void> {
    await this.db.execute_(
      `UPDATE route_stops t
          SET board_charge_minor = f.board_charge_minor, drop_charge_minor = f.drop_charge_minor
         FROM route_stops f
        WHERE t.tenant_id = $1 AND t.route_id = $3 AND f.route_id = $2 AND f.stop_id = t.stop_id`,
      [requireTenantId(), fromRouteId, toRouteId],
      { name: 'route.copyPointCharges', primary: true },
    );
  }

  /** The per-seat charges for boarding at one stop and getting off at another. */
  async chargesFor(
    routeId: RouteId,
    fromStopId: StopId,
    toStopId: StopId,
  ): Promise<{ boardMinor: number; dropMinor: number }> {
    const stops = await this.stopsWithNames(routeId);
    return {
      boardMinor: stops.find((s) => s.id === fromStopId)?.boardChargeMinor ?? 0,
      dropMinor: stops.find((s) => s.id === toStopId)?.dropChargeMinor ?? 0,
    };
  }

  /** The route's stops in order with their timing offset and board/alight rules. */
  async stopRules(routeId: RouteId): Promise<
    {
      stopId: StopId;
      sequence: number;
      departOffsetMin: number;
      canBoard: boolean;
      canAlight: boolean;
    }[]
  > {
    return this.db.query(
      `SELECT stop_id AS "stopId", sequence, depart_offset_min AS "departOffsetMin",
              can_board AS "canBoard", can_alight AS "canAlight"
         FROM route_stops WHERE route_id = $1 ORDER BY sequence`,
      [routeId],
      { name: 'route.stopRules', primary: true },
    );
  }
}

interface RouteRow {
  id: RouteId;
  code: string;
  name: string;
  origin_city_id: CityId;
  dest_city_id: CityId;
  status: RouteStatus;
}
interface StopRow {
  stop_id: StopId;
  sequence: number;
  distance_from_origin_m: number;
  depart_offset_min: number;
  dwell_min: number;
  can_board: boolean;
  can_alight: boolean;
}
