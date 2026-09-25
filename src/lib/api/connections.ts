import { get, post } from './client';

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
  search: (originCityId: string, destinationCityId: string, date: string) =>
    get<{ options: ConnectingOption[] }>(`/v1/search/connecting?originCityId=${originCityId}&destinationCityId=${destinationCityId}&date=${date}`),

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
