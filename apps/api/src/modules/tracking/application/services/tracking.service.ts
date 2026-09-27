import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  AppError,
  DomainError,
  ErrorCode,
  requireTenantId,
  runInNewContext,
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
import {
  gpsProblem,
  trackingMessage,
  trackingPhase,
  trackingStartsAt,
  type TrackingPhase,
} from '../../domain/tracking-window';
import {
  TrackingRepository,
  type CrewOnDuty,
  type TripClockRow,
} from '../../infrastructure/persistence/tracking.repository';

/** A delay alert goes out at 15+ minutes late, and again at each further 15 minutes. */
const DELAY_ALERT_STEP_MINUTES = 15;

/** "30 Sep, 8:30 pm" in the operator's own timezone. */
export function formatLocalTime(d: Date, timeZone: string): string {
  return d
    .toLocaleString('en-IN', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\s?(AM|PM)$/i, (m) => m.toLowerCase());
}

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
    private readonly uow: UnitOfWork,
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

    // The crew phone shares GPS only from one hour before departure until the
    // trip is over — never a bus parked at the depot the night before, never
    // after the passengers got off.
    const clock = await this.tracking.tripClock(input.tripId);
    if (!clock) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    const problem = gpsProblem(clock, new Date(), (d) => formatLocalTime(d, clock.timezone));
    if (problem) throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: problem });

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
    if (clock.status !== 'departed') {
      // Still at the boarding point (the hour before departure): it is late
      // only once its departure time has passed — a parked bus is not
      // "hours behind" for the next stop.
      delayMinutes = Math.max(
        0,
        Math.round((recordedAt.getTime() - clock.departsAt.getTime()) / 60000),
      );
    } else if (nextScheduled) {
      const projectedArrival = new Date(recordedAt.getTime() + eta.etaSeconds * 1000);
      delayMinutes = Math.round(
        (projectedArrival.getTime() - new Date(nextScheduled.departsAt).getTime()) / 60000,
      );
    }

    // The live row and any delay alert commit together (an event is only
    // ever written inside the transaction of the change it describes).
    await this.uow.run({ name: 'tracking.ping', tenantId }, async () => {
      const before = await this.tracking.live(input.tripId);
      await this.tracking.upsertLive({
        tripId: input.tripId,
        tenantId,
        lat: input.lat,
        lng: input.lng,
        speedKmph: input.speedKmph,
        distanceCoveredM: input.distanceCoveredM,
        nextStopId: eta.nextStopId,
        nextStopEtaAt: eta.nextStopId
          ? new Date(recordedAt.getTime() + eta.etaSeconds * 1000)
          : null,
        delayMinutes,
        lastPingAt: recordedAt,
      });

      // Passengers hear of a material delay (>15 min) once per further
      // 15 minutes of lateness — not on every ping the phone sends.
      const band = (m: number) => Math.floor(m / DELAY_ALERT_STEP_MINUTES);
      if (
        delayMinutes > DELAY_ALERT_STEP_MINUTES &&
        band(delayMinutes) > band(before?.delayMinutes ?? 0)
      ) {
        this.events.publish({
          type: 'trip.delayed',
          aggregateType: 'trip',
          aggregateId: input.tripId,
          payload: { delayMinutes, nextStopId: eta.nextStopId },
        });
      }
    });

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
  /** Every bus of this operator on the road, with its last position. */
  fleetOnTheRoad() {
    return this.tracking.fleetOnTheRoad();
  }

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

  /** Drivers (one to three) and the conductor / attendants on duty, with their phones. */
  tripCrew(tripId: string): Promise<CrewOnDuty[]> {
    return this.tracking.tripCrew(tripId);
  }

  /**
   * PUBLIC — no ambient tenant context. Resolves the tenant from the trip
   * embedded in the token, then reads within that tenant's own RLS scope.
   *
   * The link works for the whole life of the booking but shows the bus only
   * while it can be tracked (from an hour before departure until the trip is
   * over); before and after, it says why and when — never a bare error.
   */
  async getLiveLocationByToken(token: string): Promise<{
    phase: TrackingPhase | 'booking_cancelled';
    message: string;
    trackingStartsAt: string;
    departsAt: string;
    arrivesAt: string;
    endedAt: string | null;
    busNumber: string | null;
    crew: CrewOnDuty[];
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
    // A forged or garbled link is refused outright. An expired one (its
    // fixed expiry is scheduled arrival + 12 h) is still a genuine link: it
    // gets the "journey ended" answer below — or the map, if a very late
    // bus is somehow still on the road.
    let payload: TrackingTokenPayload;
    try {
      payload = verifyTrackingTokenSignatureOnly(token, sig);
    } catch (err) {
      const forged = err instanceof DomainError && err.code === ErrorCode.COMMON_FORBIDDEN;
      throw new AppError(
        forged ? ErrorCode.COMMON_FORBIDDEN : ErrorCode.COMMON_VALIDATION,
        forged ? 403 : 400,
        {
          message:
            'This tracking link is not valid. Please use the link from your ticket or reminder message.',
        },
      );
    }
    const expired = (() => {
      try {
        verifyTrackingToken(token, sig, Date.now());
        return false;
      } catch {
        return true;
      }
    })();

    const tenantId = await this.tracking.tenantOfTripPublic(payload.tripId);
    if (!tenantId)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });

    return runInNewContext({ tenantId, actorType: 'system' }, async () => {
      const [clock, stops] = await Promise.all([
        this.tracking.tripClock(payload.tripId),
        this.tracking.bookingStopNames(tenantId, payload.bookingId),
      ]);
      if (!clock)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });

      const now = new Date();
      let phase: TrackingPhase | 'booking_cancelled' = trackingPhase(clock, now);
      if (phase === 'live' && expired) phase = 'ended';
      if (stops && stops.status === 'cancelled' && phase !== 'cancelled')
        phase = 'booking_cancelled';

      const fmt = (d: Date) => formatLocalTime(d, clock.timezone);
      const endedAt = this.endedAt(clock);
      const message =
        phase === 'booking_cancelled'
          ? 'This booking was cancelled, so its tracking link no longer shows the bus.'
          : trackingMessage(phase, {
              startsAt: fmt(trackingStartsAt(clock)),
              departsAt: fmt(clock.departsAt),
              endedAt: endedAt ? fmt(endedAt) : null,
            });

      const live = phase === 'live';
      const [position, pings, crew] = await Promise.all([
        live ? this.tracking.live(payload.tripId) : null,
        live ? this.tracking.recentPings(payload.tripId, 20) : [],
        // Who to call: shown while the journey is ahead or under way.
        phase === 'live' || phase === 'too_early'
          ? this.tracking.tripCrew(payload.tripId)
          : ([] as CrewOnDuty[]),
      ]);
      return {
        phase,
        message,
        trackingStartsAt: trackingStartsAt(clock).toISOString(),
        departsAt: clock.departsAt.toISOString(),
        arrivesAt: clock.arrivesAt.toISOString(),
        endedAt: endedAt ? endedAt.toISOString() : null,
        busNumber: clock.busNumber,
        crew,
        status: live ? (position?.status ?? 'not_started') : phase,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        speedKmph: position?.speedKmph ?? 0,
        delayMinutes: position?.delayMinutes ?? 0,
        lastPingAt: position?.lastPingAt ? position.lastPingAt.toISOString() : null,
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

  /** When the journey finished: the crew's arrival, else the scheduled arrival. */
  private endedAt(clock: TripClockRow): Date | null {
    if (clock.status === 'cancelled') return null;
    return clock.actualArrivedAt ?? clock.arrivesAt;
  }
}
