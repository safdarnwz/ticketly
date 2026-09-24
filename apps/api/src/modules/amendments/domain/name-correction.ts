/**
 * Passenger name CORRECTION (510) — not a transfer.
 *
 * A booking can't be handed to someone else by "correcting" the name, so only
 * a small edit is allowed: after normalising case / spaces / dots, the new
 * name must be within max(2, 20% of its length) character edits of the old
 * one ("Rahul Shrma" → "Rahul Sharma" ok; "Rahul Sharma" → "Amit Verma" no).
 * At most MAX_CORRECTIONS per passenger, and not within the cut-off before
 * boarding (the manifest has been printed by then).
 */
export const MAX_CORRECTIONS = 2;
export const NAME_CUTOFF_MINUTES = 60;

export function normaliseName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[.\-_,']/g, ' ').replace(/\s+/g, ' ').trim();
}

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function checkNameCorrection(input: { oldName: string; newName: string; previousCorrections: number; boardingAt: Date; now?: Date }): string | null {
  const now = input.now ?? new Date();
  const oldN = normaliseName(input.oldName);
  const newN = normaliseName(input.newName);
  if (newN.length < 2) return 'Enter the passenger’s full name';
  if (!/^[\p{L} ]+$/u.test(newN)) return 'A name can only contain letters and spaces';
  if (oldN === newN && input.oldName.trim() === input.newName.trim()) return 'The name is unchanged';
  if (input.previousCorrections >= MAX_CORRECTIONS) return `A name can be corrected at most ${MAX_CORRECTIONS} times`;
  if (input.boardingAt.getTime() - now.getTime() < NAME_CUTOFF_MINUTES * 60_000) return `Names can be corrected only until ${NAME_CUTOFF_MINUTES} minutes before boarding`;
  const allowed = Math.max(2, Math.floor(Math.max(oldN.length, newN.length) * 0.2));
  if (editDistance(oldN, newN) > allowed) return 'That is a different person, not a spelling correction — tickets cannot be transferred';
  return null;
}
