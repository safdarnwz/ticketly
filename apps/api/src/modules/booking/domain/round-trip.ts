/* ───────────── round-trip discount (283) ───────────── */

/** The onward booking a return booking claims the discount against. */
export interface OnwardLeg {
  status: string;
  customerId: string | null;
  contactPhone: string | null;
  fromCityId: string;
  toCityId: string;
  departsAt: Date;
}

/** The return journey being booked. */
export interface ReturnLeg {
  fromCityId: string;
  toCityId: string;
  departsAt: Date;
}

const lastTen = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').slice(-10);

/**
 * Why this journey cannot be the discounted return of `onward`, or null.
 * The return goes back the other way (from where the onward journey ends to
 * where it starts), leaves after the onward bus, and is booked by the same
 * person — the signed-in customer who booked the onward trip, or the same
 * booking mobile.
 */
export function roundTripProblem(
  onward: OnwardLeg | null,
  ret: ReturnLeg,
  who: { userId: string | null; contactPhone?: string | null },
): string | null {
  if (!onward) return 'The onward booking was not found';
  if (onward.status !== 'confirmed') return 'The onward booking is not confirmed';
  const sameCustomer = Boolean(who.userId && onward.customerId && who.userId === onward.customerId);
  const samePhone = Boolean(
    lastTen(who.contactPhone) && lastTen(who.contactPhone) === lastTen(onward.contactPhone),
  );
  if (!sameCustomer && !samePhone) return 'The onward booking was not found';
  if (ret.fromCityId !== onward.toCityId || ret.toCityId !== onward.fromCityId)
    return 'The return journey must go back the way the onward journey came';
  if (ret.departsAt.getTime() <= onward.departsAt.getTime())
    return 'The return bus must leave after the onward bus';
  return null;
}

/**
 * Take `pct`% off every seat's fare (after concessions). GST shrinks in the
 * same proportion and the discount absorbs the rest, keeping
 * base − discount + tax = total exact to the paisa.
 */
export function applyRoundTripDiscount(
  priced: {
    fareBySeat: Map<string, number>;
    totals: { baseMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
  },
  pct: number,
): {
  fareBySeat: Map<string, number>;
  totals: { baseMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
  roundTripMinor: number;
} {
  const p = Math.max(0, Math.min(50, pct));
  const out = new Map(priced.fareBySeat);
  let off = 0;
  for (const [seat, fare] of out) {
    const cut = Math.min(fare, Math.round((fare * p) / 100));
    out.set(seat, fare - cut);
    off += cut;
  }
  const t = priced.totals;
  if (off === 0) return { fareBySeat: out, totals: { ...t }, roundTripMinor: 0 };
  const totalMinor = t.totalMinor - off;
  const taxMinor = t.totalMinor > 0 ? Math.round((t.taxMinor * totalMinor) / t.totalMinor) : 0;
  const discountMinor = t.baseMinor + taxMinor - totalMinor;
  return {
    fareBySeat: out,
    totals: { baseMinor: t.baseMinor, discountMinor, taxMinor, totalMinor },
    roundTripMinor: off,
  };
}
