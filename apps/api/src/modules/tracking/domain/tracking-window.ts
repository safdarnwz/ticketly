/**
 * When a bus can be tracked. The crew phone shares GPS from one hour before
 * departure until the trip is closed; the passenger's tracking link shows the
 * bus only in that window, and otherwise says plainly why not:
 *
 *   too_early  — more than an hour before departure: "tracking starts at …"
 *   live       — from departure − 1 h until the crew closes the trip (a late
 *                bus stays live while it is still on the road)
 *   ended      — the trip was closed, or the bus never ran and its arrival
 *                time is more than an hour past
 *   cancelled  — the operator cancelled the trip
 */
export const GPS_LEAD_MINUTES = 60;
/** A bus that never reported leaving stops being "coming up" this long after its arrival time. */
export const ENDED_AFTER_ARRIVAL_MINUTES = 60;

export type TrackingPhase = 'too_early' | 'live' | 'ended' | 'cancelled';

export interface TripClock {
  departsAt: Date;
  arrivesAt: Date;
  status: string; // scheduled | open | departed | closed | cancelled
  actualDepartedAt?: Date | null;
  actualArrivedAt?: Date | null;
}

export function trackingStartsAt(trip: Pick<TripClock, 'departsAt'>): Date {
  return new Date(trip.departsAt.getTime() - GPS_LEAD_MINUTES * 60_000);
}

export function trackingPhase(trip: TripClock, now: Date): TrackingPhase {
  if (trip.status === 'cancelled') return 'cancelled';
  // Closed after running (the crew marked it arrived) — the journey is over.
  if (trip.status === 'closed' && (trip.actualDepartedAt || trip.actualArrivedAt)) return 'ended';
  if (trip.status === 'departed') return 'live';
  if (now.getTime() < trackingStartsAt(trip).getTime()) return 'too_early';
  if (now.getTime() > trip.arrivesAt.getTime() + ENDED_AFTER_ARRIVAL_MINUTES * 60_000)
    return 'ended';
  return 'live';
}

/** The words the tracking page shows for a phase (times already in the traveller's local form). */
export function trackingMessage(
  phase: TrackingPhase,
  times: { startsAt: string; departsAt: string; endedAt?: string | null },
): string {
  switch (phase) {
    case 'too_early':
      return `Live tracking starts at ${times.startsAt}, one hour before your bus leaves at ${times.departsAt}. Please check again then.`;
    case 'ended':
      return times.endedAt
        ? `This journey ended at ${times.endedAt}. Live tracking is closed.`
        : 'This journey is over. Live tracking is closed.';
    case 'cancelled':
      return 'This trip was cancelled by the operator, so there is nothing to track. Your refund details are in the cancellation message.';
    default:
      return 'Your bus is live on the map.';
  }
}

/** Whether a GPS ping from the crew phone is taken now, and why not if refused. */
export function gpsProblem(
  trip: TripClock,
  now: Date,
  formatTime: (d: Date) => string,
): string | null {
  const phase = trackingPhase(trip, now);
  if (phase === 'too_early')
    return `GPS sharing starts at ${formatTime(trackingStartsAt(trip))}, one hour before departure`;
  if (phase === 'ended') return 'This trip has ended — GPS sharing is off';
  if (phase === 'cancelled') return 'This trip was cancelled';
  return null;
}
