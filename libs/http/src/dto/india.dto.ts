import { createRequire } from 'node:module';

import { z } from 'zod';

/**
 * Indian PIN codes and bank IFSCs, checked against published directories
 * instead of a shape-only regex — a typo'd PIN or a branch that does not
 * exist is refused at the edge, and forms can fill city / state / bank from
 * what the customer typed.
 *
 *  - PIN codes: `india-pincode-lookup` (every post office, with its
 *    district and state).
 *  - IFSCs: the `ifsc` package (Razorpay's copy of the RBI branch list) —
 *    its bank-code → branch list and bank names. Its own online client needs
 *    the long-deprecated `request` package, so branch details are fetched
 *    here with the built-in fetch instead (see `ifscBranchDetails`).
 *
 * Both datasets are loaded on first use, not at boot.
 */

const load = createRequire(__filename);

/* ───────────── PIN codes ───────────── */

interface PostOffice {
  officeName: string;
  pincode: number;
  taluk: string;
  districtName: string;
  stateName: string;
}

export interface PincodeInfo {
  pincode: string;
  /** The district — what a form calls the city. */
  city: string;
  district: string;
  state: string;
  /** Post offices under this PIN (localities), A–Z. */
  localities: string[];
}

let pincodeIndex: Map<string, PostOffice[]> | null = null;
function pincodes(): Map<string, PostOffice[]> {
  if (!pincodeIndex) {
    const all = load('india-pincode-lookup/pincodes.json') as PostOffice[];
    pincodeIndex = new Map();
    for (const o of all) {
      const key = String(o.pincode);
      const list = pincodeIndex.get(key);
      if (list) list.push(o);
      else pincodeIndex.set(key, [o]);
    }
  }
  return pincodeIndex;
}

/** "NORTH DELHI" / "north delhi" → "North Delhi". */
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, 'and');
/** Post-office names end in their kind: "Sadar Bazar S.O" → "Sadar Bazar". */
const locality = (office: string) =>
  office
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+(S\.?O|B\.?O|H\.?O|G\.?P\.?O|P\.?O)\.?$/i, '')
    .trim();

export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

/** City, district, state and localities of a PIN, or null when there is no such PIN. */
export function lookupPincode(pin: string): PincodeInfo | null {
  if (!PINCODE_PATTERN.test(pin)) return null;
  const offices = pincodes().get(pin);
  if (!offices?.length) return null;
  // The district most of its post offices sit in (a few PINs straddle two).
  const count = new Map<string, number>();
  for (const o of offices) count.set(o.districtName, (count.get(o.districtName) ?? 0) + 1);
  const district = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const state = offices.find((o) => o.districtName === district)!.stateName;
  return {
    pincode: pin,
    city: titleCase(district),
    district: titleCase(district),
    state: titleCase(state),
    localities: [...new Set(offices.map((o) => locality(o.officeName)))].sort(),
  };
}

/** A 6-digit PIN that exists. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(PINCODE_PATTERN, 'A PIN code is 6 digits and does not start with 0')
  .refine((v) => lookupPincode(v) !== null, 'No post office has this PIN code');

/* ───────────── IFSCs ───────────── */

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

let ifscBranches: Record<string, (number | string)[]> | null = null;
let ifscBankNames: Record<string, string> | null = null;

/** True when the IFSC is a branch in the RBI list (the `ifsc` package's own rule). */
export function isKnownIfsc(code: string): boolean {
  const ifsc = code.trim().toUpperCase();
  if (!IFSC_PATTERN.test(ifsc)) return false;
  ifscBranches ??= load('ifsc/src/IFSC.json') as Record<string, (number | string)[]>;
  const branches = ifscBranches[ifsc.slice(0, 4)];
  if (!branches) return false;
  const branch = ifsc.slice(5);
  return /^\d+$/.test(branch) ? branches.includes(parseInt(branch, 10)) : branches.includes(branch);
}

/** The bank's name for an IFSC (its first four letters), or null. */
export function ifscBankName(code: string): string | null {
  ifscBankNames ??= load('ifsc/src/banknames.json') as Record<string, string>;
  return ifscBankNames[code.trim().toUpperCase().slice(0, 4)] ?? null;
}

/** Upper-cased, and a branch that exists. */
export const ifscSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(IFSC_PATTERN, 'An IFSC is 11 characters, like HDFC0001234')
      .refine(isKnownIfsc, 'No bank branch has this IFSC — check it on the cheque book'),
  );

export interface IfscBranch {
  ifsc: string;
  bankCode: string;
  bank: string;
  branch: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
}

const branchCache = new Map<string, IfscBranch>();

/**
 * The bank, and — when the IFSC directory service answers within a few
 * seconds — the branch, address, city and state. Null for an IFSC that does
 * not exist. Never throws: offline, it returns the bank alone.
 */
export async function ifscBranchDetails(
  code: string,
  timeoutMs = 3000,
): Promise<IfscBranch | null> {
  const ifsc = code.trim().toUpperCase();
  if (!isKnownIfsc(ifsc)) return null;
  const cached = branchCache.get(ifsc);
  if (cached) return cached;
  const base: IfscBranch = {
    ifsc,
    bankCode: ifsc.slice(0, 4),
    bank: ifscBankName(ifsc) ?? ifsc.slice(0, 4),
    branch: null,
    address: null,
    city: null,
    district: null,
    state: null,
  };
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return base;
    const d = (await res.json()) as Record<string, string | undefined>;
    const full: IfscBranch = {
      ...base,
      bank: d.BANK ?? base.bank,
      branch: d.BRANCH ?? null,
      address: d.ADDRESS ?? null,
      city: d.CITY ? titleCase(d.CITY) : null,
      district: d.DISTRICT ? titleCase(d.DISTRICT) : null,
      state: d.STATE ? titleCase(d.STATE) : null,
    };
    if (branchCache.size > 5000) branchCache.clear();
    branchCache.set(ifsc, full);
    return full;
  } catch {
    return base;
  }
}
