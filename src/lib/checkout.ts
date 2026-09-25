import type { CheckoutConcession, PassengerPolicy } from '@/lib/api/booking-flow';

export type Gender = 'male' | 'female' | 'other';
export type Category = 'adult' | 'child' | 'senior' | 'student' | 'defence' | 'disabled';

export interface PassengerForm {
  seatNumber: string;
  fullName: string;
  age: string;
  gender: Gender | '';
  category: Category;
  idProof: string;
}

export const CATEGORY_LABEL: Record<string, string> = {
  adult: 'Adult',
  child: 'Child',
  senior: 'Senior citizen',
  student: 'Student',
  defence: 'Defence personnel',
  disabled: 'Person with disability',
};

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 0 prefix and spaces. */
export function normalizeMobile(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/**
 * Everything the backend would refuse, checked before the seats are held so
 * the customer sees it next to the field. Returns field errors keyed
 * `${index}.${field}` plus `form` for booking-level problems.
 */
export function validatePassengers(
  list: PassengerForm[],
  opts: { concessions: CheckoutConcession[]; policy?: PassengerPolicy; ladiesSeats: string[] },
): Record<string, string> {
  const e: Record<string, string> = {};
  const adultAge = opts.policy?.adultAge ?? 18;
  list.forEach((p, i) => {
    const name = p.fullName.trim();
    if (name.length < 2) e[`${i}.fullName`] = 'Enter the passenger’s full name';
    else if (name.length > 60) e[`${i}.fullName`] = 'Name is too long';
    else if (!/^[\p{L} .'-]+$/u.test(name)) e[`${i}.fullName`] = 'Use letters only';
    const age = Number(p.age);
    if (p.age.trim() === '' || !Number.isInteger(age)) e[`${i}.age`] = 'Enter age';
    else if (age < 1 || age > 120) e[`${i}.age`] = 'Enter an age between 1 and 120';
    else if (opts.policy && age < opts.policy.infantMaxAge)
      e[`${i}.age`] = `Children under ${opts.policy.infantMaxAge} travel on a guardian’s lap — no seat needed`;
    if (!p.gender) e[`${i}.gender`] = 'Choose';
    else if (opts.ladiesSeats.includes(p.seatNumber) && p.gender !== 'female')
      e[`${i}.gender`] = `Seat ${p.seatNumber} is for women only`;
    if (p.category !== 'adult') {
      const rule = opts.concessions.find((c) => c.category === p.category);
      if (!rule) e[`${i}.category`] = 'Not offered on this bus';
      else if (Number.isInteger(age) && ((rule.minAge !== null && age < rule.minAge) || (rule.maxAge !== null && age > rule.maxAge)))
        e[`${i}.category`] = `For ages ${rule.minAge ?? 0}–${rule.maxAge ?? 120}`;
      else if (rule.requiresIdProof && p.idProof.trim().length < 4) e[`${i}.idProof`] = 'ID number is required for this concession';
    }
  });
  for (const c of opts.concessions) {
    const n = list.filter((p) => p.category === c.category).length;
    if (c.maxPerBooking !== null && n > c.maxPerBooking)
      e.form = `At most ${c.maxPerBooking} ${CATEGORY_LABEL[c.category] ?? c.category} concession${c.maxPerBooking > 1 ? 's' : ''} per booking`;
  }
  // Same rule as the backend: a 'child' concession never counts as the adult.
  const adults = list.filter((p) => p.category !== 'child' && Number(p.age) >= adultAge).length;
  if (opts.policy && !opts.policy.allowUnaccompaniedMinors && list.length > 0 && adults === 0 &&
      list.every((p) => p.age.trim() !== ''))
    e.form = `At least one passenger must be ${adultAge} or older`;
  return e;
}
