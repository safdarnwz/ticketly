/**
 * ============================================================================
 *  Agent commission slabs — volume-based commission (pure)
 * ============================================================================
 *
 * A slab says: "once this agent's sales THIS CALENDAR MONTH reach X, they
 * earn Y% on further tickets". The rate for a ticket is decided by the
 * agent's month-to-date sales BEFORE that ticket, so a sale never changes its
 * own rate and a month always starts again from the lowest slab.
 *
 * Precedence: the agent's own slabs → the operator's default slabs → the
 * agent's flat commission_pct.
 */
export interface Slab {
  minMonthlySalesMinor: number;
  commissionPct: number;
}

export class SlabRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlabRuleError';
  }
}

export const MAX_SLABS = 10;

/** Validate a slab table before saving. Returns it sorted by threshold. */
export function validateSlabs(slabs: Slab[]): Slab[] {
  if (!Array.isArray(slabs) || slabs.length === 0) throw new SlabRuleError('Add at least one slab');
  if (slabs.length > MAX_SLABS) throw new SlabRuleError(`At most ${MAX_SLABS} slabs`);
  for (const s of slabs) {
    if (!Number.isInteger(s.minMonthlySalesMinor) || s.minMonthlySalesMinor < 0)
      throw new SlabRuleError('Slab thresholds must be whole paise, zero or more');
    if (
      typeof s.commissionPct !== 'number' ||
      s.commissionPct < 0 ||
      s.commissionPct > 50 ||
      Math.round(s.commissionPct * 100) !== s.commissionPct * 100
    ) {
      throw new SlabRuleError('Commission must be between 0% and 50%, at most 2 decimals');
    }
  }
  const sorted = [...slabs].sort((a, b) => a.minMonthlySalesMinor - b.minMonthlySalesMinor);
  if (sorted[0].minMonthlySalesMinor !== 0)
    throw new SlabRuleError(
      'The first slab must start at ₹0 (otherwise early-month sales have no rate)',
    );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minMonthlySalesMinor === sorted[i - 1].minMonthlySalesMinor)
      throw new SlabRuleError('Two slabs have the same threshold');
    if (sorted[i].commissionPct < sorted[i - 1].commissionPct)
      throw new SlabRuleError('A higher slab cannot pay a lower commission');
  }
  return sorted;
}

/** The rate for the NEXT ticket, given month-to-date sales so far. */
export function rateFor(input: {
  agentSlabs: Slab[];
  operatorSlabs: Slab[];
  flatPct: number;
  monthSalesMinor: number;
}): { pct: number; source: 'agent_slab' | 'operator_slab' | 'flat' } {
  const pick = (slabs: Slab[]) =>
    [...slabs]
      .sort((a, b) => b.minMonthlySalesMinor - a.minMonthlySalesMinor)
      .find((s) => input.monthSalesMinor >= s.minMonthlySalesMinor);
  const own = input.agentSlabs.length ? pick(input.agentSlabs) : undefined;
  if (own) return { pct: own.commissionPct, source: 'agent_slab' };
  const def = input.operatorSlabs.length ? pick(input.operatorSlabs) : undefined;
  if (def) return { pct: def.commissionPct, source: 'operator_slab' };
  return { pct: input.flatPct, source: 'flat' };
}

/** First instant of the month containing `now`, in the operator's time zone offset (IST default). */
export function monthStart(now: Date, utcOffsetMinutes = 330): Date {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - utcOffsetMinutes * 60_000,
  );
}
