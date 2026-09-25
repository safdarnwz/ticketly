import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, NotFoundError, requireTenantId, toCsv, type StopId } from '@kernel';

import { FareRepository } from '../../infrastructure/persistence/fare.repository';

export interface FareRuleRow {
  fromStopId?: string;
  toStopId?: string;
  seatType: string;
  baseFareMinor: number;
  perKmMinor?: number;
}

/**
 * Bulk fare changes (#267): a whole sheet of segment fares (the Excel /
 * CSV export, edited and sent back as rows), or a percentage change across
 * a plan. All-or-nothing: every row is checked before any is written.
 */
@Injectable()
export class FareBulkService {
  constructor(
    private readonly fares: FareRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async importRules(farePlanId: string, rows: FareRuleRow[]): Promise<{ saved: number }> {
    const routeId = await this.fares.planRoute(farePlanId);
    if (!routeId) throw new NotFoundError('Fare plan', farePlanId);
    const stopIds = [
      ...new Set(rows.flatMap((r) => [r.fromStopId, r.toStopId]).filter((x): x is string => !!x)),
    ];
    const onRoute = await this.fares.stopsOnRoute(routeId, stopIds);
    const errors: { row: number; error: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const row = i + 1;
      if (Boolean(r.fromStopId) !== Boolean(r.toStopId))
        errors.push({ row, error: 'Give both stops, or neither for the whole-route fare' });
      for (const s of [r.fromStopId, r.toStopId])
        if (s && !onRoute.has(s)) errors.push({ row, error: `Stop ${s} is not on this route` });
      if (r.fromStopId && r.fromStopId === r.toStopId)
        errors.push({ row, error: 'From and to stop are the same' });
      const key = `${r.fromStopId ?? ''}|${r.toStopId ?? ''}|${r.seatType}`;
      if (seen.has(key)) errors.push({ row, error: 'Duplicate of an earlier row' });
      seen.add(key);
    });
    if (errors.length > 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `${errors.length} row(s) have problems; nothing was saved`,
        details: { errors },
      });
    await this.uow.run({ name: 'pricing.importRules', tenantId: requireTenantId() }, async () => {
      for (const r of rows)
        await this.fares.addRule({
          farePlanId,
          fromStopId: r.fromStopId as StopId | undefined,
          toStopId: r.toStopId as StopId | undefined,
          seatType: r.seatType,
          baseFareMinor: r.baseFareMinor,
          perKmMinor: r.perKmMinor,
        });
    });
    return { saved: rows.length };
  }

  async adjust(
    farePlanId: string,
    input: { percent: number; seatType?: string; roundToMinor: number },
  ): Promise<{ updated: number }> {
    if (!(await this.fares.planRoute(farePlanId))) throw new NotFoundError('Fare plan', farePlanId);
    const updated = await this.uow.run(
      { name: 'pricing.adjustRules', tenantId: requireTenantId() },
      () =>
        this.fares.adjustRules(
          farePlanId,
          input.percent,
          input.seatType ?? null,
          input.roundToMinor,
        ),
    );
    return { updated };
  }

  /** The plan's rules as CSV — the sheet an operator edits and imports back. */
  async exportCsv(farePlanId: string): Promise<string> {
    if (!(await this.fares.planRoute(farePlanId))) throw new NotFoundError('Fare plan', farePlanId);
    const rules = await this.fares.listRules(farePlanId);
    return toCsv(['fromStopId', 'toStopId', 'seatType', 'baseFareMinor', 'perKmMinor'], rules);
  }
}
