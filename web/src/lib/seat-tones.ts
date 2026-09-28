import type { SeatCell } from '@/lib/api/booking-flow';

/** How a seat looks on the shared seat map (booking colours, and the crew's states). */
export type SeatTone =
  | 'available'
  | 'selected'
  | 'booked'
  | 'bookedFemale'
  | 'forFemale'
  | 'forMale'
  | 'blocked'
  // crew / chart states
  | 'pending'
  | 'boarded'
  | 'checkedOut'
  | 'noShow'
  | 'empty';

export interface SeatView {
  tone: SeatTone;
  /** Short text under / inside the seat instead of a price (e.g. initials). */
  caption?: string;
  /** A small marker in the corner (e.g. bag count). */
  badge?: string;
  clickable?: boolean;
}

export const TONE_LABEL: Record<SeatTone, string> = {
  available: 'Available',
  selected: 'Selected',
  booked: 'Booked',
  bookedFemale: 'Booked by a woman',
  forFemale: 'For women',
  forMale: 'For men',
  blocked: 'Not for sale',
  pending: 'To board',
  boarded: 'Checked in',
  checkedOut: 'Checked out',
  noShow: 'No-show',
  empty: 'Empty',
};

/** How a seat looks while booking: taken, kept for someone, or free. */
export function bookingTone(s: SeatCell, isSelected: boolean): SeatTone {
  if (isSelected) return 'selected';
  if (!s.available) return s.bookedGender === 'female' ? 'bookedFemale' : 'booked';
  if (s.ladiesOnly || s.reservedFor === 'female') return 'forFemale';
  if (s.reservedFor === 'male') return 'forMale';
  return 'available';
}

