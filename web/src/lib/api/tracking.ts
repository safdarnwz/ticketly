import { get } from './client';

export interface LiveTripState {
  lat: number | null;
  lng: number | null;
  speedKmph: number | null;
  nextStopId: string | null;
  nextStopEtaAt: string | null;
  delayMinutes: number | null;
  status: string | null;
  lastPingAt: string | null;
}

/**
 * When the link shows the bus: from one hour before departure until the trip
 * is over. Outside that the API says why (`message`) — never a bare error.
 */
export type TrackingPhase = 'too_early' | 'live' | 'ended' | 'cancelled' | 'booking_cancelled';

export interface CrewContact {
  role: 'driver' | 'conductor' | 'attendant' | string;
  name: string;
  phone: string | null;
}

export interface LiveLocation {
  phase: TrackingPhase;
  message: string;
  trackingStartsAt: string;
  departsAt: string;
  arrivesAt: string;
  endedAt: string | null;
  busNumber: string | null;
  /** Every driver (one to three) and the conductor / attendants; empty once the journey is over. */
  crew: CrewContact[];
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
}

export const trackingApi = {
  /** Public — no login/tenant header needed, matches the ticket the customer holds. */
  live: (tripId: string) => get<LiveTripState | null>(`/v1/tracking/trips/${tripId}/live`),
  /** Public, signed-token version — for the shareable /track/:token link sent with the e-ticket/PNR (no tripId or login needed, the token IS the access). */
  byToken: (token: string) => get<LiveLocation>(`/v1/tracking/token/${encodeURIComponent(token)}`),
};
