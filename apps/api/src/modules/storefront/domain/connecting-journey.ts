import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Connecting-journey builder
 * ============================================================================
 *
 * Many city pairs have no direct bus but are reachable via a hub (A→H, H→B).
 * This builds valid two-leg journeys from two sets of single-leg results,
 * pairing a first leg with a second leg only when:
 *
 *   - they meet at the SAME hub (firstLeg.toHub === secondLeg.fromHub),
 *   - the layover is within [minLayoverMin, maxLayoverMin] — long enough to make
 *     the connection, short enough not to be a hotel stay,
 *   - the second leg departs AFTER the first arrives (no time travel).
 *
 * Combined price is the sum of legs; combined duration spans first departure to
 * second arrival (so it INCLUDES the layover — the honest door-to-door time).
 * Pure and deterministic: the connection rules are unit-testable in isolation.
 */

export interface JourneyLeg {
  tripId: string;
  fromHub: string;   // origin stop/city id of this leg
  toHub: string;     // destination stop/city id of this leg
  departsAt: string; // ISO 8601
  arrivesAt: string; // ISO 8601
  priceMinor: number;
  availableSeats: number;
  currency: string;
}

export interface ConnectionOptions {
  minLayoverMin: number;
  maxLayoverMin: number;
}

export interface ConnectingJourney {
  legs: [JourneyLeg, JourneyLeg];
  hub: string;
  layoverMin: number;
  totalPriceMinor: number;
  totalDurationMin: number;
  minSeats: number; // bottleneck seat availability across the two legs
  currency: string;
}

function toMs(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid timestamp '${iso}'`);
  return t;
}

export function buildConnections(
  firstLegs: JourneyLeg[],
  secondLegs: JourneyLeg[],
  options: ConnectionOptions,
): ConnectingJourney[] {
  if (options.minLayoverMin < 0 || options.maxLayoverMin < options.minLayoverMin) {
    throw new DomainError(ErrorCode.CONNECTION_INVALID_LAYOVER, 'Layover window is invalid', {
      details: { minLayoverMin: options.minLayoverMin, maxLayoverMin: options.maxLayoverMin },
    });
  }

  const out: ConnectingJourney[] = [];
  for (const first of firstLegs) {
    for (const second of secondLegs) {
      if (first.toHub !== second.fromHub) continue;
      // Avoid a pointless "connection" that loops back to the start.
      if (second.toHub === first.fromHub) continue;

      const layoverMin = Math.round((toMs(second.departsAt) - toMs(first.arrivesAt)) / 60000);
      if (layoverMin < options.minLayoverMin || layoverMin > options.maxLayoverMin) continue;

      out.push({
        legs: [first, second],
        hub: first.toHub,
        layoverMin,
        totalPriceMinor: first.priceMinor + second.priceMinor,
        totalDurationMin: Math.round((toMs(second.arrivesAt) - toMs(first.departsAt)) / 60000),
        minSeats: Math.min(first.availableSeats, second.availableSeats),
        currency: first.currency,
      });
    }
  }

  // Best door-to-door duration first, then cheaper.
  out.sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.totalPriceMinor - b.totalPriceMinor);
  return out;
}
