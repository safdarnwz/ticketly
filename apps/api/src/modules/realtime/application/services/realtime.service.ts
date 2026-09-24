import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { type TripId } from '@kernel';

import { seatDelta, type SeatDelta } from '../../domain/sse';

export interface SeatUpdate {
  data: { tripId: string } & SeatDelta;
  type: 'seat.update';
}

/**
 * Live seat-availability fan-out over SSE.
 *
 * The storefront subscribes to a trip; when availability changes we push only
 * the delta (which seats were taken/freed), computed by the pure `seatDelta`.
 * Streams are per-trip `Subject`s, created lazily and shared by all subscribers
 * to that trip.
 *
 * SCALE-OUT: in a multi-instance deployment the `publishAvailability` fan-in is
 * backed by Redis pub/sub (libs/cache already runs a Redis subscriber for cache
 * invalidation) so a booking on instance A reaches SSE clients on instance B.
 * Here the in-process `Subject` is the single-instance path; the interface is
 * identical.
 */
@Injectable()
export class RealtimeService {
  private readonly streams = new Map<string, Subject<SeatUpdate>>();
  private readonly lastAvailable = new Map<string, string[]>();

  private subjectFor(tripId: string): Subject<SeatUpdate> {
    let s = this.streams.get(tripId);
    if (!s) {
      s = new Subject<SeatUpdate>();
      this.streams.set(tripId, s);
    }
    return s;
  }

  /** The SSE stream for a trip (an Observable of seat-update messages). */
  stream(tripId: TripId): Observable<SeatUpdate> {
    return this.subjectFor(tripId).asObservable();
  }

  /**
   * Publish the current available-seat set for a trip. Emits a delta only when
   * something actually changed since the last publish, so idle trips are silent.
   */
  publishAvailability(tripId: TripId, availableSeats: string[]): SeatDelta {
    const prev = this.lastAvailable.get(tripId) ?? availableSeats;
    const delta = seatDelta(prev, availableSeats);
    this.lastAvailable.set(tripId, availableSeats);
    if (delta.changed) {
      this.subjectFor(tripId).next({ type: 'seat.update', data: { tripId, ...delta } });
    }
    return delta;
  }
}
