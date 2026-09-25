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

export interface LiveLocation {
  status: 'not_started' | 'running' | 'arrived' | 'completed';
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
  byToken: (token: string) => get<LiveLocation>(`/v1/track/${token}`),
};
