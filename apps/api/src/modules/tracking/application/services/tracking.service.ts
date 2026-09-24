import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { AppError, ErrorCode, requireTenantId, runInNewContext, type TripId } from '@kernel';
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
import { TrackingRepository } from '../../infrastructure/persistence/tracking.repository';

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
    private readonly tracking: TrackingRepository,
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
    await this.tracking.insertPing({
      tenantId,
      tripId: input.tripId,
      vehicleId: input.vehicleId ?? null,
      lat: input.lat,
      lng: input.lng,
      speedKmph: input.speedKmph,
      headingDeg: input.headingDeg ?? null,
      distanceCoveredM: input.distanceCoveredM,
      recordedAt,
    });

    // Compute next-stop ETA from the trip's snapshotted stops.
    const stops = await this.tracking.tripStops(input.tripId);
    const progress: StopProgress[] = stops.map((s) => ({
      stopId: s.stopId,
      distanceFromOriginM: s.distanceM,
    }));
    const eta = nextStopEta(progress, input.distanceCoveredM, input.speedKmph);

    // Delay: compare projected arrival at the next stop to its scheduled time.
    let delayMinutes = 0;
    const nextScheduled = stops.find((s) => s.stopId === eta.nextStopId);
    if (nextScheduled) {
      const projectedArrival = new Date(recordedAt.getTime() + eta.etaSeconds * 1000);
      delayMinutes = Math.round(
        (projectedArrival.getTime() - new Date(nextScheduled.departsAt).getTime()) / 60000,
      );
    }

    await this.tracking.upsertLive({
      tripId: input.tripId,
      tenantId,
      lat: input.lat,
      lng: input.lng,
      speedKmph: input.speedKmph,
      distanceCoveredM: input.distanceCoveredM,
      nextStopId: eta.nextStopId,
      nextStopEtaAt: eta.nextStopId ? new Date(recordedAt.getTime() + eta.etaSeconds * 1000) : null,
      delayMinutes,
      lastPingAt: recordedAt,
    });

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
  liveState(tripId: TripId): Promise<Record<string, unknown> | null> {
    return this.tracking.liveStatePublic(tripId);
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
      if ((await this.tracking.liveStatusPublic(sigOnly.tripId)) === 'running') {
        payload = sigOnly; // genuinely still en route — extend past the fixed expiry
      } else {
        throw err; // actually expired (trip completed, or never had live data) — the original error stands
      }
    }

    const tenantId = await this.tracking.tenantOfTripPublic(payload.tripId);
    if (!tenantId)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });

    return runInNewContext({ tenantId, actorType: 'system' }, async () => {
      const [live, stops, pings] = await Promise.all([
        this.tracking.live(payload.tripId),
        this.tracking.bookingStopNames(tenantId, payload.bookingId),
        this.tracking.recentPings(payload.tripId, 20),
      ]);
      return {
        status: live?.status ?? 'not_started',
        lat: live?.lat ?? null,
        lng: live?.lng ?? null,
        speedKmph: live?.speedKmph ?? 0,
        delayMinutes: live?.delayMinutes ?? 0,
        lastPingAt: live?.lastPingAt ? live.lastPingAt.toISOString() : null,
        pnr: payload.pnr,
        fromStopName: stops?.fromStopName ?? 'Boarding point',
        toStopName: stops?.toStopName ?? 'Dropping point',
        recentPings: pings.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          recordedAt: p.recordedAt.toISOString(),
        })),
      };
    });
  }
}
