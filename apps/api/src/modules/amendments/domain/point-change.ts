/**
 * ============================================================================
 *  Boarding / dropping point change — pure rules
 * ============================================================================
 *
 * Same trip, same seats, different boarding and/or dropping stop.
 *  - the new boarding stop must allow boarding, the new drop must allow alighting,
 *    and boarding must come before dropping on the route;
 *  - nothing to change → refused (no pointless amendment rows);
 *  - cut-off: the change must happen at least CUTOFF minutes before the bus
 *    reaches the EARLIER of the old and new boarding stops (you cannot move
 *    your pick-up to a stop the bus has already passed, nor abandon one it is
 *    about to reach);
 *  - money: only within the same fare (same fare stage). A fare difference
 *    would need a payment or refund — that is a reschedule, not a point change.
 */
export const POINT_CHANGE_CUTOFF_MINUTES = 60;

export interface RouteStop { stopId: string; sequence: number; departOffsetMin: number; canBoard: boolean; canAlight: boolean }

export class PointChangeError extends Error {
  constructor(message: string) { super(message); this.name = 'PointChangeError'; }
}

export function planPointChange(input: {
  stops: RouteStop[]; current: { fromSeq: number; toSeq: number };
  newFromStopId?: string | null; newToStopId?: string | null;
  tripDepartsAt: Date; now?: Date; cutoffMinutes?: number;
}): { fromSeq: number; toSeq: number; fromStopId: string; toStopId: string } {
  const now = input.now ?? new Date();
  const cutoff = (input.cutoffMinutes ?? POINT_CHANGE_CUTOFF_MINUTES) * 60_000;
  const bySeq = new Map(input.stops.map((s) => [s.sequence, s]));
  const byId = new Map(input.stops.map((s) => [s.stopId, s]));
  const oldFrom = bySeq.get(input.current.fromSeq);
  const oldTo = bySeq.get(input.current.toSeq);
  if (!oldFrom || !oldTo) throw new PointChangeError('The booked stops are no longer on this route — contact the operator');

  const from = input.newFromStopId ? byId.get(input.newFromStopId) : oldFrom;
  const to = input.newToStopId ? byId.get(input.newToStopId) : oldTo;
  if (!from) throw new PointChangeError('That boarding point is not on this route');
  if (!to) throw new PointChangeError('That dropping point is not on this route');
  if (input.newFromStopId && !from.canBoard) throw new PointChangeError('Boarding is not allowed at that stop');
  if (input.newToStopId && !to.canAlight) throw new PointChangeError('Alighting is not allowed at that stop');
  if (from.sequence >= to.sequence) throw new PointChangeError('The boarding point must come before the dropping point');
  if (from.sequence === oldFrom.sequence && to.sequence === oldTo.sequence) throw new PointChangeError('These are already your boarding and dropping points');

  const earliestBoard = Math.min(oldFrom.departOffsetMin, from.departOffsetMin);
  const boardAt = input.tripDepartsAt.getTime() + earliestBoard * 60_000;
  if (boardAt - now.getTime() < cutoff) {
    throw new PointChangeError(`Points can be changed only until ${(input.cutoffMinutes ?? POINT_CHANGE_CUTOFF_MINUTES)} minutes before boarding`);
  }
  return { fromSeq: from.sequence, toSeq: to.sequence, fromStopId: from.stopId, toStopId: to.stopId };
}

/** Same fare stage = identical base fare for every seat type on the booking. */
export function sameFare(oldFares: (number | null)[], newFares: (number | null)[]): boolean {
  return oldFares.length === newFares.length && oldFares.every((f, i) => f !== null && newFares[i] !== null && f === newFares[i]);
}
