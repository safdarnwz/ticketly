import { Permission } from '@contracts';

const KNOWN = new Set<string>(Object.values(Permission));

/** Held only by Ticketly's own staff; never part of an operator role. */
const PLATFORM_ONLY = new Set<string>([
  Permission.ALL,
  Permission.PLATFORM_ADMIN,
  Permission.PLATFORM_OPERATORS,
]);

/**
 * Why an operator user may not put these permissions into a role (or give
 * someone a role holding them). Empty = fine.
 *
 *  - only catalogue permissions exist — a typo would silently grant nothing;
 *  - platform permissions (`*`, `platform:*`) are never part of an operator role;
 *  - nobody hands out a permission they do not hold themselves, so a manager
 *    with `role:manage` cannot build (or take) a role bigger than their own.
 *    Holding `*` means holding everything operator-side.
 */
export function permissionGrantProblems(
  requested: readonly string[],
  caller: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const p of new Set(requested)) {
    if (!KNOWN.has(p)) problems.push(`unknown permission '${p}'`);
    else if (PLATFORM_ONLY.has(p)) problems.push(`'${p}' is a platform permission`);
    else if (!caller.has(Permission.ALL) && !caller.has(p))
      problems.push(`you do not hold '${p}' yourself`);
  }
  return problems;
}
