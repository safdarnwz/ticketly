/**
 * ============================================================================
 *  Passenger categories, concessions & infant policy — pure
 * ============================================================================
 *
 * Every seated passenger has a category (adult by default). An operator
 * configures, per category, a concession % (off the seat's fare), an age band,
 * whether an ID proof is required and a validity window (e.g. student
 * concession only during term). Infants (under the infant age) do NOT get a
 * seat; they travel on an adult's lap with a free or fixed-charge policy.
 *
 * Rules enforced here (each maps to scenarios in the GDS scenario file):
 *  - the passenger's age must fit the category band — a child fare can't be
 *    given to an adult or vice versa (1214, 1215);
 *  - student / defence need an ID proof number (1549);
 *  - a concession outside its date window, or inactive, is refused (1547, 1548);
 *  - at least one adult (18+) per booking unless the operator allows
 *    unaccompanied minors (5007); each infant needs an adult (1216) and at most
 *    one infant per adult (5006);
 *  - money: each concession reduces that seat's fare; totals are rebuilt so
 *    base − discount + tax = total always holds (the ledger relies on it).
 */
export const CATEGORIES = ['adult', 'child', 'senior', 'student', 'defence', 'disabled'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories an operator can attach a concession to (every one but a full-fare adult). */
export const CONCESSION_CATEGORIES = ['child', 'senior', 'student', 'defence', 'disabled'] as const;
export type ConcessionCategory = (typeof CONCESSION_CATEGORIES)[number];

export interface ConcessionRule {
  category: Category;
  discountPct: number; // 0–100
  minAge: number | null;
  maxAge: number | null;
  requiresIdProof: boolean;
  validFrom: string | null; // YYYY-MM-DD, journey date
  validTo: string | null;
  maxPerBooking: number | null;
  active: boolean;
}

export interface PassengerPolicy {
  adultAge: number; // default 18
  infantMaxAge: number; // infants are strictly below this age (default 5)
  infantFeeMinor: number; // 0 = free
  allowUnaccompaniedMinors: boolean; // default false
}
export const DEFAULT_POLICY: PassengerPolicy = {
  adultAge: 18,
  infantMaxAge: 5,
  infantFeeMinor: 0,
  allowUnaccompaniedMinors: false,
};

/**
 * Why a concession rule would give the wrong fare — null when it is fine.
 * A child band reaching adult age would sell adults child fares; a senior band
 * with no lower age would give anyone the senior discount.
 */
export function concessionRuleProblem(
  r: Pick<ConcessionRule, 'category' | 'discountPct' | 'minAge' | 'maxAge' | 'validTo' | 'active'>,
  policy: PassengerPolicy,
  today: string,
): string | null {
  if (r.active && r.discountPct === 0)
    return 'A 0% concession gives nothing — switch it off instead';
  if (r.validTo && r.validTo < today) return 'That end date has already passed';
  if (r.category === 'child') {
    if (r.maxAge === null) return 'Set the oldest age that counts as a child';
    if (r.maxAge >= policy.adultAge)
      return `A child must be younger than your adult age (${policy.adultAge})`;
    if (r.minAge !== null && r.minAge < policy.infantMaxAge)
      return `Children under ${policy.infantMaxAge} already travel as infants`;
  }
  if (r.category === 'senior') {
    if (r.minAge === null) return 'Set the age from which someone is a senior citizen';
    if (r.minAge < policy.adultAge) return 'A senior citizen must be at least adult age';
  }
  return null;
}

/** Why changing the passenger policy would break a concession already set up — null when fine. */
export function policyProblem(policy: PassengerPolicy, rules: ConcessionRule[]): string | null {
  const child = rules.find((r) => r.category === 'child' && r.active);
  if (child?.maxAge != null && child.maxAge >= policy.adultAge)
    return `Your child concession runs to age ${child.maxAge} — lower it before setting adult age to ${policy.adultAge}`;
  if (policy.infantMaxAge >= policy.adultAge) return 'Infant age must be below adult age';
  return null;
}

export interface SeatedPassenger {
  seatNumber: string;
  fullName: string;
  age?: number;
  category?: Category;
  idProof?: string;
}
export interface Infant {
  fullName: string;
  age: number;
  guardianSeat: string;
}

export class PassengerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PassengerRuleError';
  }
}

export function validatePassengers(input: {
  passengers: SeatedPassenger[];
  infants: Infant[];
  rules: ConcessionRule[];
  policy?: PassengerPolicy;
  journeyDate: string;
}): void {
  const policy = input.policy ?? DEFAULT_POLICY;
  const rules = new Map(input.rules.map((r) => [r.category, r]));
  const perCategory = new Map<Category, number>();
  let adults = 0;

  for (const p of input.passengers) {
    const cat: Category = p.category ?? 'adult';
    if (!(CATEGORIES as readonly string[]).includes(cat))
      throw new PassengerRuleError(`Unknown passenger category '${cat}'`);
    if (p.age !== undefined && (!Number.isInteger(p.age) || p.age < 0 || p.age > 120))
      throw new PassengerRuleError(`Invalid age for ${p.fullName}`);
    if (p.age !== undefined && p.age < policy.infantMaxAge) {
      throw new PassengerRuleError(
        `${p.fullName} is under ${policy.infantMaxAge} — add them as an infant (no seat) with an adult, or give their correct age`,
      );
    }
    if (cat !== 'adult') {
      const rule = rules.get(cat);
      if (!rule || !rule.active)
        throw new PassengerRuleError(`The ${cat} concession is not offered on this service`);
      if (rule.validFrom && input.journeyDate < rule.validFrom)
        throw new PassengerRuleError(`The ${cat} concession starts on ${rule.validFrom}`);
      if (rule.validTo && input.journeyDate > rule.validTo)
        throw new PassengerRuleError(`The ${cat} concession ended on ${rule.validTo}`);
      if ((rule.minAge !== null || rule.maxAge !== null) && p.age === undefined)
        throw new PassengerRuleError(`Age is required for the ${cat} concession (${p.fullName})`);
      if (rule.minAge !== null && p.age! < rule.minAge)
        throw new PassengerRuleError(
          `${p.fullName} is too young for the ${cat} concession (minimum ${rule.minAge})`,
        );
      if (rule.maxAge !== null && p.age! > rule.maxAge)
        throw new PassengerRuleError(
          `${p.fullName} is too old for the ${cat} concession (maximum ${rule.maxAge})`,
        );
      if (rule.requiresIdProof && (p.idProof?.trim().length ?? 0) < 4)
        throw new PassengerRuleError(
          `An ID proof number is required for the ${cat} concession (${p.fullName})`,
        );
      const n = (perCategory.get(cat) ?? 0) + 1;
      if (rule.maxPerBooking !== null && n > rule.maxPerBooking)
        throw new PassengerRuleError(
          `At most ${rule.maxPerBooking} ${cat} concession(s) per booking`,
        );
      perCategory.set(cat, n);
    }
    // Adult (for accompanying rules) = age at/above adultAge; unknown age counts as adult unless the category says child.
    const isAdult = cat !== 'child' && (p.age === undefined || p.age >= policy.adultAge);
    if (isAdult) adults += 1;
  }

  if (adults === 0 && !policy.allowUnaccompaniedMinors)
    throw new PassengerRuleError('At least one adult must travel on this booking');
  const seats = new Set(input.passengers.map((p) => p.seatNumber.trim()));
  const perGuardian = new Map<string, number>();
  for (const inf of input.infants) {
    if (!Number.isInteger(inf.age) || inf.age < 0 || inf.age >= policy.infantMaxAge)
      throw new PassengerRuleError(
        `${inf.fullName}: infants must be under ${policy.infantMaxAge} — book a seat for older children`,
      );
    if (!inf.fullName?.trim()) throw new PassengerRuleError('Infant name is required');
    const g = inf.guardianSeat.trim();
    if (!seats.has(g))
      throw new PassengerRuleError(
        `${inf.fullName} must travel with a passenger on this booking (seat ${g} is not on it)`,
      );
    const guardian = input.passengers.find((p) => p.seatNumber.trim() === g)!;
    if (
      guardian.category === 'child' ||
      (guardian.age !== undefined && guardian.age < policy.adultAge)
    )
      throw new PassengerRuleError(`${inf.fullName} must travel with an adult`);
    perGuardian.set(g, (perGuardian.get(g) ?? 0) + 1);
    if (perGuardian.get(g)! > 1)
      throw new PassengerRuleError(`Only one infant per adult (seat ${g})`);
  }
}

/** Apply concessions to per-seat fares and rebuild totals so base − discount + tax = total. */
export function applyConcessions(input: {
  fareBySeat: Map<string, number>;
  passengers: SeatedPassenger[];
  rules: ConcessionRule[];
  totals: { baseMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
  infantCount: number;
  policy?: PassengerPolicy;
}): {
  fareBySeat: Map<string, number>;
  totals: { baseMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
  concessionMinor: number;
  infantFeesMinor: number;
} {
  const policy = input.policy ?? DEFAULT_POLICY;
  const rules = new Map(input.rules.map((r) => [r.category, r]));
  const out = new Map(input.fareBySeat);
  let concession = 0;
  for (const p of input.passengers) {
    const cat = p.category ?? 'adult';
    const rule = cat === 'adult' ? undefined : rules.get(cat);
    if (!rule || rule.discountPct <= 0) continue;
    const seat = p.seatNumber.trim();
    const fare = out.get(seat) ?? 0;
    const off = Math.min(fare, Math.round((fare * Math.min(100, rule.discountPct)) / 100));
    out.set(seat, fare - off);
    concession += off;
  }
  const infantFees = Math.max(0, input.infantCount) * Math.max(0, policy.infantFeeMinor);
  const t = input.totals;
  if (concession === 0 && infantFees === 0)
    return { fareBySeat: out, totals: { ...t }, concessionMinor: 0, infantFeesMinor: 0 };
  const seatTotal = t.totalMinor - concession;
  const taxMinor = t.totalMinor > 0 ? Math.round((t.taxMinor * seatTotal) / t.totalMinor) : 0; // tax shrinks in proportion
  const totalMinor = seatTotal + infantFees;
  // Keep the invariant exactly: discount absorbs the rest (infant fee is an addition to base).
  const baseMinor = t.baseMinor + infantFees;
  const discountMinor = baseMinor + taxMinor - totalMinor;
  return {
    fareBySeat: out,
    totals: { baseMinor, discountMinor, taxMinor, totalMinor },
    concessionMinor: concession,
    infantFeesMinor: infantFees,
  };
}

/* ───────────── booking window (242 / 243) ───────────── */

export interface BookingWindow {
  maxAdvanceDays: number | null;
  minMinutesBeforeDeparture: number;
}
export const DEFAULT_BOOKING_WINDOW: BookingWindow = {
  maxAdvanceDays: null,
  minMinutesBeforeDeparture: 0,
};

/** Sales open `maxAdvanceDays` before departure and close `minMinutesBeforeDeparture` before it. */
export function checkBookingWindow(
  departsAt: Date,
  window: BookingWindow = DEFAULT_BOOKING_WINDOW,
  now: Date = new Date(),
): string | null {
  const msLeft = departsAt.getTime() - now.getTime();
  if (msLeft <= window.minMinutesBeforeDeparture * 60_000) {
    return window.minMinutesBeforeDeparture > 0
      ? `Online booking closes ${window.minMinutesBeforeDeparture} minutes before departure`
      : 'This bus has already departed';
  }
  if (window.maxAdvanceDays !== null && msLeft > window.maxAdvanceDays * 86_400_000) {
    return `Bookings open ${window.maxAdvanceDays} days before departure`;
  }
  return null;
}
