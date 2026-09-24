/**
 * Operator pricing rules applied to the base fare before the engine — pure.
 *  - peak / off-peak by DEPARTURE time (159, 160, 231): windows of local
 *    minutes with a % (+ for peak, − for off-peak); overnight windows allowed;
 *    if windows overlap, the largest |%| wins (no stacking by accident);
 *  - manual trip adjustment (354 low-occupancy discount, 355 high-demand hike).
 * The combined adjustment is capped to −50 % … +100 % so a typo can't give
 * seats away or price them absurdly.
 */
export interface PeakWindow { startMinute: number; endMinute: number; pct: number; label?: string }
export const MIN_ADJUST_PCT = -50;
export const MAX_ADJUST_PCT = 100;

export function inWindow(w: PeakWindow, minute: number): boolean {
  return w.startMinute < w.endMinute ? minute >= w.startMinute && minute < w.endMinute : minute >= w.startMinute || minute < w.endMinute;
}

export function validatePeakWindows(ws: PeakWindow[]): string | null {
  if (ws.length > 12) return 'At most 12 time windows';
  for (const w of ws) {
    if (![w.startMinute, w.endMinute].every((m) => Number.isInteger(m) && m >= 0 && m <= 1439)) return 'Times must be between 00:00 and 23:59';
    if (w.startMinute === w.endMinute) return 'A window cannot start and end at the same time';
    if (!(w.pct >= MIN_ADJUST_PCT && w.pct <= MAX_ADJUST_PCT) || w.pct === 0) return `Each window needs a non-zero % between ${MIN_ADJUST_PCT} and +${MAX_ADJUST_PCT}`;
  }
  return null;
}

export function adjustmentPct(input: { departureMinuteLocal: number; peakWindows: PeakWindow[]; tripPct: number | null }): number {
  const hits = input.peakWindows.filter((w) => inWindow(w, input.departureMinuteLocal));
  const peak = hits.reduce((best, w) => (Math.abs(w.pct) > Math.abs(best) ? w.pct : best), 0);
  const total = peak + (input.tripPct ?? 0);
  return Math.max(MIN_ADJUST_PCT, Math.min(MAX_ADJUST_PCT, total));
}

export function applyAdjustment(baseFareMinor: number, pct: number): number {
  return Math.max(0, Math.round(baseFareMinor * (1 + pct / 100)));
}

/** Validate a floor/ceiling pair. */
export function validateBounds(floorMinor: number | null, ceilingMinor: number | null): string | null {
  if (floorMinor !== null && (!Number.isInteger(floorMinor) || floorMinor < 0)) return 'Floor must be a whole, non-negative amount';
  if (ceilingMinor !== null && (!Number.isInteger(ceilingMinor) || ceilingMinor <= 0)) return 'Ceiling must be a positive whole amount';
  if (floorMinor !== null && ceilingMinor !== null && floorMinor > ceilingMinor) return 'Floor cannot be above the ceiling';
  return null;
}
