/**
 * How an operator's services are named: the route's city codes and the
 * departure time — DEL-PAT-1500 is the Delhi → Patna service leaving at
 * 15:00. The name belongs to the service, not to a bus: whichever bus runs it
 * on a day, the trip is "DEL-PAT-1500 on 30 Sep".
 *
 * Two live services of one operator leaving the same route at the same time
 * (a sleeper and a seater at 21:30) become DEL-PAT-2130-A and DEL-PAT-2130-B;
 * a third is -C. Codes are per operator: two operators may both run a
 * DEL-PAT-2130.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Letters, digits and single hyphens; 2–40 characters, upper case. */
export const SERVICE_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9])){1,39}$/;

export function normaliseServiceCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '-');
}

export function serviceCodeBase(
  originCityCode: string,
  destCityCode: string,
  startMinute: number,
): string {
  const hh = String(Math.floor(startMinute / 60)).padStart(2, '0');
  const mm = String(startMinute % 60).padStart(2, '0');
  return `${originCityCode}-${destCityCode}-${hh}${mm}`;
}

export interface CodeHolder {
  id: string;
  code: string;
  /** Not ended or deleted. */
  live: boolean;
  /** Same origin and destination cities and the same departure time as the new service. */
  sameSlot: boolean;
}

export interface CodeAllocation {
  code: string;
  /** The service that had the plain code becomes -A, now that a second one leaves at its time. */
  rename?: { id: string; from: string; to: string };
}

/**
 * The code for a new service, given the operator's services whose code is the
 * base or the base with a letter. Null when all 26 letters are taken.
 */
export function allocateServiceCode(base: string, holders: CodeHolder[]): CodeAllocation | null {
  const taken = new Set(holders.map((h) => h.code));
  if (!taken.has(base)) {
    // The base is free. It is also the right name unless lettered services
    // already share this time (the plain one was renamed -A earlier).
    const lettered = holders.some((h) => h.code !== base && h.live && h.sameSlot);
    if (!lettered) return { code: base };
  }
  const plain = holders.find((h) => h.code === base);
  const letters = [...LETTERS].filter((l) => !taken.has(`${base}-${l}`));
  if (plain && plain.live && plain.sameSlot && !taken.has(`${base}-A`)) {
    // DEL-PAT-2130 → DEL-PAT-2130-A, and the new one is -B.
    const next = letters.find((l) => l !== 'A');
    if (!next) return null;
    return { code: `${base}-${next}`, rename: { id: plain.id, from: base, to: `${base}-A` } };
  }
  return letters.length ? { code: `${base}-${letters[0]}` } : null;
}
