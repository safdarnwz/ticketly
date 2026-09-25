import {
  addMinutes,
  DomainError,
  ErrorCode,
  formatMinuteOfDay,
  type MinuteOfDay,
  type StopId,
} from '@kernel';

/**
 * ============================================================================
 *  Route path — ordered stops with derived timing & segments
 * ============================================================================
 *
 * A route is an ordered list of stops. Each stop after the first carries the
 * running distance and running time from the origin, PLUS a departure offset
 * (minutes after the service's start) — from which arrival clock-times and
 * day-offsets are DERIVED, never hand-entered (hand-entered day-offsets are the
 * classic source of "arrives yesterday" bugs).
 *
 * The other job of this model is to enumerate **segments**: every bookable
 * (origin, destination) pair along the route. A 4-stop route A→B→C→D yields 6
 * segments (A-B, A-C, A-D, B-C, B-D, C-D). This is the foundation the
 * segment-wise inventory engine (Part 5) sits on: a seat sold A→C must remain
 * unavailable for A-B, A-C, B-C but free for C-D.
 *
 * Pure and deterministic → exhaustively unit-tested (see __tests__).
 */

export interface RouteStopInput {
  stopId: StopId;
  /** Sequence, 0-based, strictly increasing. */
  sequence: number;
  /** Running distance from the route origin, in metres. Non-decreasing. */
  distanceFromOriginM: number;
  /** Minutes after the service start-time that the bus DEPARTS this stop. */
  departOffsetMin: number;
  /** Dwell time at the stop (arrival = depart - dwell). Defaults to 0. */
  dwellMin?: number;
  /** Whether passengers may board / alight here. */
  canBoard?: boolean;
  canAlight?: boolean;
}

export interface ComputedStop {
  stopId: StopId;
  sequence: number;
  distanceFromOriginM: number;
  /** Arrival clock-time relative to service start (minute-of-day + dayOffset). */
  arrivalMinute: MinuteOfDay;
  arrivalDayOffset: number;
  departMinute: MinuteOfDay;
  departDayOffset: number;
  canBoard: boolean;
  canAlight: boolean;
}

export interface Segment {
  fromStopId: StopId;
  toStopId: StopId;
  fromSequence: number;
  toSequence: number;
  distanceM: number;
  durationMin: number;
}

export class RoutePath {
  private constructor(
    readonly stops: ComputedStop[],
    private readonly startMinute: MinuteOfDay,
  ) {}

  /** Reconstruct the original RouteStopInput[] this path was built from — used to duplicate a route without re-deriving fragile timing math by hand. */
  toRouteStopInputs(): RouteStopInput[] {
    return this.stops.map((s) => ({
      stopId: s.stopId,
      sequence: s.sequence,
      distanceFromOriginM: s.distanceFromOriginM,
      departOffsetMin: s.departDayOffset * 1440 + s.departMinute - this.startMinute,
    }));
  }

  get originStartMinute(): MinuteOfDay {
    return this.startMinute;
  }

  /**
   * When a trip that leaves its origin at `tripDepartsAt` departs from (or
   * arrives at) the stop with this sequence — what a passenger boarding or
   * getting off mid-route actually sees. Null for an unknown sequence.
   */
  instantAt(sequence: number, tripDepartsAt: Date, at: 'depart' | 'arrive'): Date | null {
    const origin = this.stops[0];
    const stop = this.stops.find((s) => s.sequence === sequence);
    if (!origin || !stop) return null;
    const offset =
      at === 'arrive'
        ? stop.arrivalDayOffset * 1440 + stop.arrivalMinute
        : stop.departDayOffset * 1440 + stop.departMinute;
    const originOffset = origin.departDayOffset * 1440 + origin.departMinute;
    return new Date(tripDepartsAt.getTime() + (offset - originOffset) * 60_000);
  }

  /**
   * Build and validate a path. `startMinute` is the service's origin departure
   * time (minute-of-day); it anchors the clock-time computation.
   */
  static create(startMinute: MinuteOfDay, rawStops: RouteStopInput[]): RoutePath {
    if (rawStops.length < 2) {
      throw fail('A route needs at least 2 stops (origin and destination)');
    }

    const sorted = [...rawStops].sort((a, b) => a.sequence - b.sequence);

    // Sequences must be unique and strictly increasing from 0.
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].sequence !== i) {
        throw fail(
          `Stop sequences must be 0,1,2,… with no gaps (found ${sorted[i].sequence} at position ${i})`,
        );
      }
    }

    let prevDistance = -1;
    let prevDepart = -1;
    const computed: ComputedStop[] = sorted.map((stop, index) => {
      // Monotonic distance and time — you cannot travel backwards.
      if (stop.distanceFromOriginM < prevDistance) {
        throw fail(
          `Distance decreases at stop ${index} (${stop.distanceFromOriginM}m after ${prevDistance}m)`,
        );
      }
      if (index === 0) {
        if (stop.departOffsetMin !== 0) throw fail('The origin stop must depart at offset 0');
      } else if (stop.departOffsetMin <= prevDepart) {
        throw fail(`Departure time does not advance at stop ${index}`);
      }
      prevDistance = stop.distanceFromOriginM;
      prevDepart = stop.departOffsetMin;

      const dwell = stop.dwellMin ?? 0;
      if (dwell < 0) throw fail(`Negative dwell time at stop ${index}`);

      const depart = addMinutes(startMinute, stop.departOffsetMin);
      // Arrival is dwell minutes before departure (origin arrives = departs).
      const arrive = index === 0 ? depart : addMinutes(startMinute, stop.departOffsetMin - dwell);

      return {
        stopId: stop.stopId,
        sequence: stop.sequence,
        distanceFromOriginM: stop.distanceFromOriginM,
        arrivalMinute: arrive.minute,
        arrivalDayOffset: arrive.dayOffset,
        departMinute: depart.minute,
        departDayOffset: depart.dayOffset,
        // Origin can't be alighted at; final stop can't be boarded at.
        canBoard: (stop.canBoard ?? true) && index !== sorted.length - 1,
        canAlight: (stop.canAlight ?? true) && index !== 0,
      };
    });

    return new RoutePath(computed, startMinute);
  }

  /** Total journey distance (origin → final stop), metres. */
  get totalDistanceM(): number {
    return this.stops[this.stops.length - 1].distanceFromOriginM;
  }

  /** Total journey duration, minutes. */
  get totalDurationMin(): number {
    const last = this.stops[this.stops.length - 1];
    const lastAbsolute = last.arrivalDayOffset * 1440 + last.arrivalMinute;
    const firstAbsolute = this.stops[0].departDayOffset * 1440 + this.stops[0].departMinute;
    return lastAbsolute - firstAbsolute;
  }

  /**
   * Enumerate every bookable segment. A segment is valid only when its origin
   * allows boarding and its destination allows alighting — so a
   * technical/refuelling stop that is board-only or alight-only is respected.
   */
  segments(): Segment[] {
    const out: Segment[] = [];
    for (let i = 0; i < this.stops.length; i += 1) {
      const from = this.stops[i];
      if (!from.canBoard) continue;
      for (let j = i + 1; j < this.stops.length; j += 1) {
        const to = this.stops[j];
        if (!to.canAlight) continue;
        out.push({
          fromStopId: from.stopId,
          toStopId: to.stopId,
          fromSequence: from.sequence,
          toSequence: to.sequence,
          distanceM: to.distanceFromOriginM - from.distanceFromOriginM,
          durationMin:
            to.arrivalDayOffset * 1440 +
            to.arrivalMinute -
            (from.departDayOffset * 1440 + from.departMinute),
        });
      }
    }
    return out;
  }

  /** Human-readable timetable, for debugging and the operator console. */
  timetable(): string[] {
    return this.stops.map(
      (s) =>
        `#${s.sequence} arr ${formatMinuteOfDay(s.arrivalMinute)}${s.arrivalDayOffset ? `+${s.arrivalDayOffset}d` : ''} ` +
        `dep ${formatMinuteOfDay(s.departMinute)}${s.departDayOffset ? `+${s.departDayOffset}d` : ''} ` +
        `${(s.distanceFromOriginM / 1000).toFixed(1)}km`,
    );
  }

  /** The two sequence indices for a (from,to) stop pair, or null if invalid. */
  segmentIndexOf(fromStopId: StopId, toStopId: StopId): { from: number; to: number } | null {
    const from = this.stops.find((s) => s.stopId === fromStopId);
    const to = this.stops.find((s) => s.stopId === toStopId);
    if (!from || !to || from.sequence >= to.sequence) return null;
    if (!from.canBoard || !to.canAlight) return null;
    return { from: from.sequence, to: to.sequence };
  }
}

function fail(message: string): DomainError {
  return new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid route: ${message}`);
}
