import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseService, UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  requireTenantId,
  runInNewContext,
  type StopId,
  type TenantId,
  type TripId,
} from '@kernel';
import { EventBus } from '@messaging';
import { hmacSha256 } from '@security';

import { nextStopEta, type StopProgress } from '../../domain/geo';
import {
  trackingSigningInput,
  encodeTrackingToken,
  verifyTrackingToken,
  verifyTrackingTokenSignatureOnly,
  type TrackingTokenPayload,
} from '../../domain/tracking-token';

/**
 * GPS ingestion & live trip state.
 *
 * INGESTION is optimised for write throughput: a ping is a single INSERT into
 * the day-partitioned `gps_pings` (append-only), plus an UPSERT of the trip's
 * single `trip_live` row with the derived next-stop ETA and delay. The heavy
 * table is never read on the hot path — the live map reads `trip_live`, a cheap
 * single-row lookup.
 *
 * A large delay crossing a threshold emits `trip.delayed`, which the
 * notification handler turns into passenger alerts — again, the tracking module
 * never calls notifications directly.
 */
@Injectable()
export class TrackingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly config: AppConfig,
  ) {}

  async ingestPing(input: {
    tripId: TripId;
    vehicleId?: string;
    lat: number;
    lng: number;
    speedKmph: number;
    headingDeg?: number;
    distanceCoveredM: number;
    recordedAt?: Date;
  }): Promise<{ nextStopId: string | null; etaSeconds: number; delayMinutes: number }> {
    const tenantId = requireTenantId();
    const recordedAt = input.recordedAt ?? new Date();

    // Append the raw ping (routes to the day partition automatically).
    await this.db.execute_(
      `INSERT INTO gps_pings (tenant_id, trip_id, vehicle_id, lat, lng, speed_kmph, heading_deg, distance_covered_m, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        input.tripId,
        input.vehicleId ?? null,
        input.lat,
        input.lng,
        input.speedKmph,
        input.headingDeg ?? null,
        input.distanceCoveredM,
        recordedAt,
      ],
      { name: 'tracking.ingestPing', primary: true },
    );

    // Compute next-stop ETA from the trip's snapshotted stops.
    const stops = await this.db.query<{ stop_id: StopId; distance: number; departs_at: string }>(
      `SELECT ts.stop_id, rs.distance_from_origin_m AS distance, ts.departs_at
         FROM trip_stops ts
         JOIN route_stops rs ON rs.route_id = (SELECT route_id FROM trips WHERE id = ts.trip_id) AND rs.sequence = ts.sequence
        WHERE ts.trip_id = $1 ORDER BY ts.sequence`,
      [input.tripId],
      { name: 'tracking.tripStops' },
    );
    const progress: StopProgress[] = stops.map((s) => ({
      stopId: s.stop_id,
      distanceFromOriginM: s.distance,
    }));
    const eta = nextStopEta(progress, input.distanceCoveredM, input.speedKmph);

    // Delay: compare projected arrival at the next stop to its scheduled time.
    let delayMinutes = 0;
    const nextScheduled = stops.find((s) => s.stop_id === eta.nextStopId);
    if (nextScheduled) {
      const projectedArrival = new Date(recordedAt.getTime() + eta.etaSeconds * 1000);
      delayMinutes = Math.round(
        (projectedArrival.getTime() - new Date(nextScheduled.departs_at).getTime()) / 60000,
      );
    }

    const etaAt = eta.nextStopId ? new Date(recordedAt.getTime() + eta.etaSeconds * 1000) : null;
    await this.db.execute_(
      `INSERT INTO trip_live (trip_id, tenant_id, lat, lng, speed_kmph, distance_covered_m, next_stop_id, next_stop_eta_at, delay_minutes, status, last_ping_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running',$10)
       ON CONFLICT (trip_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, speed_kmph=EXCLUDED.speed_kmph,
         distance_covered_m=EXCLUDED.distance_covered_m, next_stop_id=EXCLUDED.next_stop_id,
         next_stop_eta_at=EXCLUDED.next_stop_eta_at, delay_minutes=EXCLUDED.delay_minutes,
         status='running', last_ping_at=EXCLUDED.last_ping_at, updated_at=now()`,
      [
        input.tripId,
        tenantId,
        input.lat,
        input.lng,
        input.speedKmph,
        input.distanceCoveredM,
        eta.nextStopId,
        etaAt,
        delayMinutes,
        recordedAt,
      ],
      { name: 'tracking.upsertLive', primary: true },
    );

    // Alert on a material delay (>15 min), throttled by the notification dedupe.
    if (delayMinutes > 15) {
      this.events.publish({
        type: 'trip.delayed',
        aggregateType: 'trip',
        aggregateId: input.tripId,
        payload: { delay: delayMinutes, nextStopId: eta.nextStopId },
      });
    }

    return { nextStopId: eta.nextStopId, etaSeconds: eta.etaSeconds, delayMinutes };
  }

  /** The live position a passenger's "track my bus" screen reads. */
  /**
   * Public passenger-tracking read — called from www.ticketly.com, which has
   * no tenant of its own. `trip_id` is a globally-unique UUID regardless of
   * which tenant owns the row, so this doesn't need a tenant at all — unlike
   * the write path above (ingestPing, always called from an authenticated,
   * tenant-bound crew/device context), this runs with bypassRls and filters
   * on trip_id alone.
   */
  async liveState(tripId: TripId): Promise<Record<string, unknown> | null> {
    return this.uow.run({ name: 'tracking.liveState', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<Record<string, unknown>>(
        `SELECT lat, lng, speed_kmph AS "speedKmph", next_stop_id AS "nextStopId",
                next_stop_eta_at AS "nextStopEtaAt", delay_minutes AS "delayMinutes",
                status, last_ping_at AS "lastPingAt"
           FROM trip_live WHERE trip_id = $1`,
        [tripId],
      );
      return result.rows[0] ?? null;
    });
  }

  // ==========================================================================
  //  Signed, per-passenger tracking links (PNR-tied)
  // ==========================================================================
  // liveState() above is a bare-tripId public lookup — fine for an
  // authenticated customer viewing their OWN confirmed booking in-app, but
  // "the URL every passenger gets, tied to their PNR" needs something a
  // trip-id alone doesn't give: a link that identifies WHICH booking it's
  // for (so a shared link only ever shows that passenger's own journey
  // framing — their own boarding/dropping stop names) and that expires
  // once the journey is over. Domain-separated signing key from both the
  // ticket-signing and booking-QR keys — a leaked tracking link must never
  // double as a boarding token.

  private trackingSigningKey(): string {
    return hmacSha256(this.config.security.jwtSecret, 'ticketly:tracking-link:v1');
  }

  private signTracking(payloadPart: string): string {
    return hmacSha256(this.trackingSigningKey(), payloadPart);
  }

  /** Called with tenant context already bound (e.g. from TicketService.issueForBooking). */
  issueTrackingToken(bookingId: string, tripId: string, pnr: string, tripArrivesAt: Date): string {
    const payload: TrackingTokenPayload = {
      v: 1,
      bookingId,
      tripId,
      pnr,
      issuedAtMs: Date.now(),
      // Valid from issuance through 12h after arrival — covers the whole
      // journey plus a safety margin, unlike the QR ticket token's tight
      // boarding-cutoff-based expiry.
      expiresAtMs: tripArrivesAt.getTime() + 12 * 3600 * 1000,
    };
    const part = trackingSigningInput(payload);
    return encodeTrackingToken(part, this.signTracking(part));
  }

  buildTrackingUrl(token: string): string {
    return `${this.config.app.publicWebUrl}/track/${token}`;
  }

  /** PUBLIC — no ambient tenant context. Resolves the tenant from the trip embedded in the token, then reads within that tenant's own RLS scope. */
  async getLiveLocationByToken(token: string): Promise<{
    status: string;
    lat: number | null;
    lng: number | null;
    speedKmph: number;
    delayMinutes: number;
    lastPingAt: string | null;
    pnr: string;
    fromStopName: string;
    toStopName: string;
    recentPings: { lat: number; lng: number; recordedAt: string }[];
  }> {
    const payloadPart = token.split('.')[0] ?? '';
    const sig = this.signTracking(payloadPart);
    let payload;
    try {
      payload = verifyTrackingToken(token, sig, Date.now());
    } catch (err) {
      // The fixed expiry (scheduled-arrival + 12h) doesn't know about a
      // real-world delay — check the trip's own live status before
      // actually rejecting. Re-decoding needs the tripId even to check
      // this, which only signature-verified data can be trusted to
      // contain — never skip straight to a live-status check without it.
      const sigOnly = verifyTrackingTokenSignatureOnly(token, sig);
      const liveStatus = await this.uow.run(
        { name: 'tracking.expiryFallback', bypassRls: true },
        async (scope) =>
          scope.client.query<{ status: string | null }>(
            `SELECT status FROM trip_live WHERE trip_id = $1`,
            [sigOnly.tripId],
          ),
      );
      if (liveStatus.rows[0]?.status === 'running') {
        payload = sigOnly; // genuinely still en route — extend past the fixed expiry
      } else {
        throw err; // actually expired (trip completed, or never had live data) — the original error stands
      }
    }

    const tenantRow = await this.uow.run(
      { name: 'tracking.resolveTenant', bypassRls: true },
      async (scope) =>
        scope.client.query<{ tenant_id: string }>(`SELECT tenant_id FROM trips WHERE id = $1`, [
          payload.tripId,
        ]),
    );
    const tenantId = tenantRow.rows[0]?.tenant_id;
    if (!tenantId)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });

    return runInNewContext({ tenantId: tenantId as TenantId, actorType: 'system' }, async () => {
      const live = await this.db.queryOne<{
        status: string;
        lat: number | null;
        lng: number | null;
        speed_kmph: number;
        delay_minutes: number;
        last_ping_at: Date | null;
      }>(
        `SELECT status, lat, lng, speed_kmph, delay_minutes, last_ping_at FROM trip_live WHERE trip_id = $1`,
        [payload.tripId],
        { name: 'tracking.liveRow' },
      );

      const stops = await this.db.queryOne<{ from_stop_name: string; to_stop_name: string }>(
        `SELECT fs.name AS from_stop_name, ts.name AS to_stop_name
           FROM bookings b
           JOIN route_stops frs ON frs.tenant_id = b.tenant_id AND frs.route_id = b.route_id AND frs.sequence = b.from_seq
           JOIN route_stops trs ON trs.tenant_id = b.tenant_id AND trs.route_id = b.route_id AND trs.sequence = b.to_seq
           JOIN stops fs ON fs.id = frs.stop_id
           JOIN stops ts ON ts.id = trs.stop_id
          WHERE b.tenant_id = $1 AND b.id = $2`,
        [tenantId, payload.bookingId],
        { name: 'tracking.stopNames' },
      );

      const pings = await this.db.query<{ lat: number; lng: number; recorded_at: Date }>(
        `SELECT lat, lng, recorded_at FROM gps_pings WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT 20`,
        [payload.tripId],
        { name: 'tracking.recentPings' },
      );

      return {
        status: live?.status ?? 'not_started',
        lat: live?.lat ?? null,
        lng: live?.lng ?? null,
        speedKmph: live?.speed_kmph ?? 0,
        delayMinutes: live?.delay_minutes ?? 0,
        lastPingAt: live?.last_ping_at ? live.last_ping_at.toISOString() : null,
        pnr: payload.pnr,
        fromStopName: stops?.from_stop_name ?? 'Boarding point',
        toStopName: stops?.to_stop_name ?? 'Dropping point',
        recentPings: pings
          .reverse()
          .map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: p.recorded_at.toISOString() })),
      };
    });
  }
}
