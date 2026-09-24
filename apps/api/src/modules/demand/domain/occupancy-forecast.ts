/**
 * Occupancy forecast — pure.
 *
 * Booking pace: on comparable past trips (same service), what share of the
 * FINAL sold seats had been sold by the same number of days before departure?
 * forecast = seats sold now ÷ median pace share, capped at capacity.
 * Median (not mean) so one odd trip (a holiday rush, a breakdown) cannot skew
 * it; trips that sold nothing are excluded (their share is undefined).
 */
export interface PaceSample { soldAtSameLead: number; finalSold: number }
export interface Forecast {
  forecastSeats: number | null; forecastPct: number | null; samples: number; confidence: 'none' | 'low' | 'medium' | 'high';
  paceShare: number | null;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function forecastOccupancy(input: { currentSold: number; totalSeats: number; history: PaceSample[] }): Forecast {
  const shares = input.history.filter((h) => h.finalSold > 0).map((h) => Math.min(1, h.soldAtSameLead / h.finalSold));
  const n = shares.length;
  const confidence = n === 0 ? 'none' : n < 4 ? 'low' : n < 8 ? 'medium' : 'high';
  const share = median(shares);
  if (share === null || input.totalSeats <= 0) return { forecastSeats: null, forecastPct: null, samples: n, confidence, paceShare: share };
  // share 0 means comparable trips had sold nothing yet at this lead time:
  // fall back to the median final result rather than dividing by zero.
  const raw = share > 0 ? input.currentSold / share : median(input.history.map((h) => h.finalSold)) ?? input.currentSold;
  const forecastSeats = Math.min(input.totalSeats, Math.max(input.currentSold, Math.round(raw)));
  return { forecastSeats, forecastPct: Math.round((forecastSeats / input.totalSeats) * 1000) / 10, samples: n, confidence, paceShare: Math.round(share * 1000) / 1000 };
}
