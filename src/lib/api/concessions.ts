import { get, put } from './client';

export type ConcessionCategory = 'child' | 'senior' | 'student' | 'defence' | 'disabled';
export interface ConcessionRule {
  category: ConcessionCategory; discountPct: number; minAge: number | null; maxAge: number | null; requiresIdProof: boolean;
  validFrom: string | null; validTo: string | null; maxPerBooking: number | null; active: boolean;
}
export interface PassengerPolicy { adultAge: number; infantMaxAge: number; infantFeeMinor: number; allowUnaccompaniedMinors: boolean }
export interface BookingWindow { maxAdvanceDays: number | null; minMinutesBeforeDeparture: number }
export interface ConcessionSettings { rules: ConcessionRule[]; policy: PassengerPolicy; bookingWindow: BookingWindow; accessibleSeats: { releaseHours: number | null }; roundTrip?: { discountPct: number } }

export const concessionsApi = {
  get: () => get<ConcessionSettings>('/v1/concessions'),
  saveRule: (r: ConcessionRule) => put<{ ok: boolean }>('/v1/concessions/rules', r),
  savePolicy: (p: PassengerPolicy) => put<{ ok: boolean }>('/v1/concessions/policy', p),
  saveBookingWindow: (w: BookingWindow) => put<{ ok: boolean }>('/v1/concessions/booking-window', w),
  saveAccessibleSeats: (releaseHours: number | null) => put<{ ok: boolean }>('/v1/concessions/accessible-seats', { releaseHours }),
  /** % off the return journey of a round trip booked with this operator (0 = none). */
  saveRoundTrip: (discountPct: number) => put<{ ok: boolean; discountPct: number }>('/v1/concessions/round-trip', { discountPct }),
};
