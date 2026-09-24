import { DomainError, ErrorCode, type Json } from '@kernel';

/**
 * ============================================================================
 *  Duty roster — crew assignment conflict & rest-rule checking
 * ============================================================================
 *
 * Assigning a driver or conductor to a trip has hard safety and legal
 * constraints that this module enforces, all as pure interval logic (instants
 * as epoch-ms, no I/O):
 *
 *  1. **No overlap.** A crew member cannot be on two trips at the same time.
 *  2. **Minimum rest.** A driver must have a minimum gap (default 8h) between
 *     the end of one duty and the start of the next — driver-fatigue rules are
 *     legally mandated and morally non-negotiable for a passenger bus.
 *  3. **Maximum continuous driving / daily duty.** A driver may not exceed a
 *     daily driving cap (default 10h of actual driving within a rolling 24h).
 *
 * Scheduling (Part 5) calls `checkAssignment` before committing a crew
 * assignment; a violation is a 422 the operator must resolve, never a silent
 * override.
 */

export interface Duty {
  /** Trip / duty id, for reporting which existing duty conflicts. */
  id: string;
  crewId: string;
  /** Absolute start & end of the duty (epoch ms). */
  startMs: number;
  endMs: number;
  /** Actual driving minutes within the duty (<= duration). For rest/cap rules. */
  drivingMinutes?: number;
}

export interface RestRules {
  /** Minimum rest between consecutive duties, minutes. */
  minRestMinutes: number;
  /** Max driving minutes within any rolling 24h window. */
  maxDailyDrivingMinutes: number;
  /** Max single-duty duration, minutes. */
  maxDutyMinutes: number;
  /**
   * Max driving in ONE duty without a relief driver / mandated break, minutes.
   * (Motor Transport Workers Act, 1961: rest after 5 hours of work.) Optional
   * so older callers keep their behaviour.
   */
  maxContinuousDrivingMinutes?: number;
}

export const DEFAULT_REST_RULES: RestRules = {
  minRestMinutes: 8 * 60,
  maxDailyDrivingMinutes: 10 * 60,
  maxDutyMinutes: 16 * 60,
};

/**
 * What an operator gets when it has not configured its own rules: the base
 * rules PLUS the 5-hour continuous-driving limit. Kept separate from
 * DEFAULT_REST_RULES so existing pure callers keep their exact behaviour.
 */
export const RECOMMENDED_REST_RULES: RestRules = {
  ...DEFAULT_REST_RULES,
  maxContinuousDrivingMinutes: 5 * 60,
};

export type ConflictKind =
  | 'overlap'
  | 'insufficient_rest'
  | 'exceeds_daily_driving'
  | 'exceeds_duty_length'
  | 'exceeds_continuous_driving';

export interface Conflict {
  kind: ConflictKind;
  message: string;
  /** The existing duty that clashes, when applicable. */
  conflictingDutyId?: string;
}

export interface AssignmentCheck {
  ok: boolean;
  conflicts: Conflict[];
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Check whether `candidate` can be added to `existing` duties for the same crew
 * member without violating any rule. Returns every conflict found (not just the
 * first) so the operator sees the full picture.
 */
export function checkAssignment(
  candidate: Duty,
  existing: Duty[],
  rules: RestRules = DEFAULT_REST_RULES,
): AssignmentCheck {
  const conflicts: Conflict[] = [];

  if (candidate.endMs <= candidate.startMs) {
    conflicts.push({ kind: 'overlap', message: 'Duty end must be after its start' });
    return { ok: false, conflicts };
  }

  const dutyMinutes = (candidate.endMs - candidate.startMs) / MS_PER_MINUTE;
  if (
    rules.maxContinuousDrivingMinutes &&
    (candidate.drivingMinutes ?? 0) > rules.maxContinuousDrivingMinutes
  ) {
    conflicts.push({
      kind: 'exceeds_continuous_driving',
      message: `${Math.round(((candidate.drivingMinutes ?? 0) / 60) * 10) / 10}h of driving in one duty exceeds the ${rules.maxContinuousDrivingMinutes / 60}h continuous limit — add a relief driver or a rest break`,
    });
  }
  if (dutyMinutes > rules.maxDutyMinutes) {
    conflicts.push({
      kind: 'exceeds_duty_length',
      message: `Duty is ${Math.round(dutyMinutes / 60)}h, exceeding the ${rules.maxDutyMinutes / 60}h single-duty limit`,
    });
  }

  const sameCrew = existing.filter((d) => d.crewId === candidate.crewId && d.id !== candidate.id);

  for (const duty of sameCrew) {
    // 1. Overlap: two intervals overlap iff each starts before the other ends.
    if (candidate.startMs < duty.endMs && duty.startMs < candidate.endMs) {
      conflicts.push({
        kind: 'overlap',
        message: 'Crew is already assigned to an overlapping duty',
        conflictingDutyId: duty.id,
      });
      continue; // rest check is meaningless against an overlapping duty
    }

    // 2. Minimum rest between adjacent duties.
    const gapMs =
      candidate.startMs >= duty.endMs
        ? candidate.startMs - duty.endMs
        : duty.startMs - candidate.endMs;
    if (gapMs < rules.minRestMinutes * MS_PER_MINUTE) {
      conflicts.push({
        kind: 'insufficient_rest',
        message: `Only ${Math.round(gapMs / MS_PER_MINUTE)} min rest before/after an adjacent duty (minimum ${rules.minRestMinutes} min)`,
        conflictingDutyId: duty.id,
      });
    }
  }

  // 3. Rolling 24h driving cap: sum driving minutes of duties whose window
  //    intersects the 24h span centred on the candidate.
  const windowStart = candidate.startMs - MS_PER_DAY;
  const windowEnd = candidate.endMs + MS_PER_DAY;
  const relevant = [candidate, ...sameCrew].filter(
    (d) => d.endMs > windowStart && d.startMs < windowEnd,
  );
  const totalDriving = rollingMaxDriving(relevant);
  if (totalDriving > rules.maxDailyDrivingMinutes) {
    conflicts.push({
      kind: 'exceeds_daily_driving',
      message: `Total driving of ${Math.round(totalDriving / 60)}h in a 24h window exceeds the ${rules.maxDailyDrivingMinutes / 60}h cap`,
    });
  }

  return { ok: conflicts.length === 0, conflicts };
}

/**
 * Throwing variant used by services: raises a DomainError listing every
 * conflict, or returns cleanly.
 */
export function assertAssignable(
  candidate: Duty,
  existing: Duty[],
  rules: RestRules = DEFAULT_REST_RULES,
): void {
  const result = checkAssignment(candidate, existing, rules);
  if (!result.ok) {
    throw new DomainError(
      ErrorCode.COMMON_CONFLICT,
      `Crew assignment rejected: ${result.conflicts.map((c) => c.message).join('; ')}`,
      { details: { conflicts: result.conflicts as unknown as Json } },
    );
  }
}

/**
 * The maximum driving load in any 24h sliding window across the given duties.
 * We check each duty's start as a window anchor — the maximum always occurs at
 * a window that begins with some duty's start.
 */
function rollingMaxDriving(duties: Duty[]): number {
  if (duties.length === 0) return 0;
  const starts = duties.map((d) => d.startMs).sort((a, b) => a - b);
  let max = 0;
  for (const anchor of starts) {
    const windowEnd = anchor + MS_PER_DAY;
    let sum = 0;
    for (const duty of duties) {
      // Count a duty's driving if it starts within [anchor, anchor+24h).
      if (duty.startMs >= anchor && duty.startMs < windowEnd) {
        sum += duty.drivingMinutes ?? (duty.endMs - duty.startMs) / MS_PER_MINUTE;
      }
    }
    if (sum > max) max = sum;
  }
  return max;
}

/* ─────────────── overrides, remaining hours, attendance ─────────────── */

/**
 * A manager may approve a duty that breaks rest / driving / length limits
 * (e.g. an emergency double duty) — with a reason, recorded for compliance.
 * An OVERLAP (same person in two places) can never be approved.
 */
export function isOverridable(conflicts: Conflict[]): boolean {
  return conflicts.length > 0 && conflicts.every((c) => c.kind !== 'overlap');
}

/** Driving minutes still allowed in the 24h window ending at `atMs`, and when the crew is next rested. */
export function remainingAllowance(
  existing: Duty[],
  atMs: number,
  rules: RestRules = DEFAULT_REST_RULES,
): { remainingDrivingMinutes: number; nextAvailableAtMs: number | null } {
  const windowStart = atMs - 24 * 60 * MS_PER_MINUTE;
  let driven = 0;
  for (const d of existing) {
    if (d.endMs <= windowStart || d.startMs >= atMs) continue;
    const overlap = Math.min(d.endMs, atMs) - Math.max(d.startMs, windowStart);
    const share = d.endMs - d.startMs > 0 ? overlap / (d.endMs - d.startMs) : 0;
    driven += (d.drivingMinutes ?? 0) * share;
  }
  const lastEnd = existing.filter((d) => d.endMs <= atMs).reduce((m, d) => Math.max(m, d.endMs), 0);
  const rested = lastEnd ? lastEnd + rules.minRestMinutes * MS_PER_MINUTE : null;
  return {
    remainingDrivingMinutes: Math.max(0, Math.floor(rules.maxDailyDrivingMinutes - driven)),
    nextAvailableAtMs: rested && rested > atMs ? rested : null,
  };
}

export type Attendance = 'pending' | 'present' | 'late' | 'absent';
export const LATE_GRACE_MINUTES = 15;

/** What to record when a supervisor (or the crew member) marks attendance. */
export function resolveAttendance(input: {
  requested: 'present' | 'absent';
  dutyStartMs: number;
  markedAtMs: number;
  dutyEndMs: number;
}): Attendance {
  if (input.markedAtMs > input.dutyEndMs)
    throw new Error('This duty has already ended — attendance can no longer be marked');
  if (input.requested === 'absent') return 'absent';
  if (input.markedAtMs < input.dutyStartMs - 6 * 60 * MS_PER_MINUTE)
    throw new Error('Attendance can be marked from 6 hours before the duty starts');
  return input.markedAtMs > input.dutyStartMs + LATE_GRACE_MINUTES * MS_PER_MINUTE
    ? 'late'
    : 'present';
}
