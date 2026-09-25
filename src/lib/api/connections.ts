import { get, post } from './client';
import type { ConnectingJourney } from './storefront';

export interface ConnectingLeg {
  tenantId: string;
  operatorName: string;
  tripId: string;
  routeId: string;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departsAt: string;
  arrivesAt: string;
  baseFareMinor: number;
  availableSeats: number;
}

export interface ConnectingOption {
  connectionCityId: string;
  connectionCityName: string;
  layoverMinutes: number;
  leg1: ConnectingLeg;
  leg2: ConnectingLeg;
}

export interface ConnectionPassenger {
  seatNumber: string;
  fullName: string;
  age?: number;
  gender?: string;
}

export const connectionsApi = {
  /** Two-leg journeys via a hub city (the backend discovers the hub). */
  search: async (originCityId: string, destinationCityId: string, date: string): Promise<{ options: ConnectingOption[] }> => {
    const r = await post<{ journeys: ConnectingJourney[] }>('/v1/search/connecting', {
      originCityId,
      destCityId: destinationCityId,
      journeyDate: date,
    });
    const leg = (l: ConnectingJourney['legs'][number]): ConnectingLeg => ({
      tenantId: l.tenantId,
      operatorName: l.operatorName,
      tripId: l.tripId,
      routeId: l.routeId,
      fromStopId: l.boardingStop.id,
      fromStopName: l.boardingStop.name,
      toStopId: l.droppingStop.id,
      toStopName: l.droppingStop.name,
      departsAt: l.departsAt,
      arrivesAt: l.arrivesAt,
      baseFareMinor: l.fromPriceMinor,
      availableSeats: l.availableSeats,
    });
    return {
      options: r.journeys.map((j) => ({
        connectionCityId: j.hub,
        connectionCityName: j.legs[0].droppingStop.name,
        layoverMinutes: j.layoverMin,
        leg1: leg(j.legs[0]),
        leg2: leg(j.legs[1]),
      })),
    };
  },

  hold: (input: {
    leg1: { tenantId: string; quoteId: string; seatNumbers: string[]; passengers: ConnectionPassenger[] };
    leg2: { tenantId: string; quoteId: string; seatNumbers: string[]; passengers: ConnectionPassenger[] };
    contactPhone: string; contactEmail?: string;
  }) => post<{
    connectionId: string;
    leg1: { bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number };
    leg2: { bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number };
  }>('/v1/connections/hold', input),

  confirm: (connectionId: string, leg1Instrument: unknown, leg2Instrument: unknown) =>
    post<{
      leg1: { status: string; pnr?: string };
      leg2: { status: string; pnr?: string; error?: string };
    }>(`/v1/connections/${connectionId}/confirm`, { leg1Instrument, leg2Instrument }),

  details: (connectionId: string) =>
    get<{
      connectionId: string; status: string;
      leg1: { bookingId: string; tenantId: string; status: string; pnr: string };
      leg2: { bookingId: string; tenantId: string; status: string; pnr: string };
    }>(`/v1/connections/${connectionId}`),

  cancel: (connectionId: string) =>
    post<{ leg1RefundMinor: number; leg2RefundMinor: number }>(`/v1/connections/${connectionId}/cancel`, {}),
};
