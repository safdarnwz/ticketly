import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  NotFoundError,
  getUserId,
  requireTenantId,
  type SeatLayoutId,
} from '@kernel';

import {
  SeatMap,
  type SeatAttributePatch,
  type SeatMapProps,
} from '../../seat-layout/domain/seat-map';
import { SeatLayoutRepository } from '../../infrastructure/persistence/seat-layout.repository';

/**
 * Seat-layout service. The heavy lifting (validation) lives in the SeatMap value
 * object; this coordinates persistence. Construction throws a 422 with a precise
 * message if the layout is inconsistent, so the operator gets immediate,
 * actionable feedback in the layout designer.
 *
 * Every create/update/restore ALSO snapshots into version history, in the
 * SAME transaction — see SeatLayoutRepository.snapshotVersion's doc comment.
 */
@Injectable()
export class SeatLayoutService {
  constructor(
    private readonly layouts: SeatLayoutRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async create(
    name: string,
    layout: SeatMapProps,
  ): Promise<{ id: SeatLayoutId; summary: SeatMap['summary'] }> {
    const seatMap = SeatMap.create(layout); // validates; throws on inconsistency
    const id = await this.uow.run(
      { name: 'layout.create', tenantId: requireTenantId() },
      async () => {
        const newLayoutId = await this.layouts.create(name, seatMap);
        await this.layouts.snapshotVersion(
          newLayoutId,
          name,
          seatMap,
          getUserId() ?? null,
          'Created',
        );
        return newLayoutId;
      },
    );
    return { id, summary: seatMap.summary };
  }

  async update(
    id: SeatLayoutId,
    name: string,
    layout: SeatMapProps,
    note?: string,
  ): Promise<{ summary: SeatMap['summary'] }> {
    const seatMap = SeatMap.create(layout); // validates; throws on inconsistency
    await this.assertTripsKeepTheirSeats(id, seatMap);
    await this.uow.run({ name: 'layout.update', tenantId: requireTenantId() }, async () => {
      await this.layouts.update(id, name, seatMap);
      await this.layouts.snapshotVersion(id, name, seatMap, getUserId() ?? null, note ?? 'Edited');
    });
    return { summary: seatMap.summary };
  }

  async listVersions(id: SeatLayoutId) {
    return this.layouts.listVersions(id);
  }

  /** Roll back to an earlier version — itself recorded as a NEW version (never rewrites history), so "undo the undo" always stays possible. */
  async restoreVersion(
    id: SeatLayoutId,
    versionNumber: number,
  ): Promise<{ summary: SeatMap['summary'] }> {
    const version = await this.layouts.getVersion(id, versionNumber);
    if (!version) throw new NotFoundError('Layout version', String(versionNumber));
    const seatMap = SeatMap.create(version.layout as SeatMapProps);
    await this.assertTripsKeepTheirSeats(id, seatMap);
    await this.uow.run({ name: 'layout.restore', tenantId: requireTenantId() }, async () => {
      await this.layouts.update(id, version.name, seatMap);
      await this.layouts.snapshotVersion(
        id,
        version.name,
        seatMap,
        getUserId() ?? null,
        `Restored from version ${versionNumber}`,
      );
    });
    return { summary: seatMap.summary };
  }

  /** Set position / ladies-only / accessible on some seats (#136, #137, #141) — a new version. */
  async markSeats(id: SeatLayoutId, seatNumbers: string[], patch: SeatAttributePatch) {
    const layout = await this.layouts.getById(id);
    const next = layout.seatMap.withSeatAttributes(seatNumbers, patch);
    return this.update(id, layout.name, next.toJSON(), `Marked seats ${seatNumbers.join(', ')}`);
  }

  /** Derive window / aisle for every seat from the grid — a new version. */
  async autoPositions(id: SeatLayoutId) {
    const layout = await this.layouts.getById(id);
    return this.update(
      id,
      layout.name,
      layout.seatMap.withAutoPositions().toJSON(),
      'Window / aisle seats derived from the grid',
    );
  }

  /**
   * Trips already on sale hold their seats by number and type. Moving seats,
   * the washroom, doors or the staircase is fine — every screen redraws from
   * the layout — but renumbering, adding, removing or retyping a seat would
   * leave sold tickets pointing at seats that no longer exist.
   */
  private async assertTripsKeepTheirSeats(id: SeatLayoutId, next: SeatMap): Promise<void> {
    const current = await this.layouts.getById(id);
    const before = current.seatMap.seatIdentity();
    const after = next.seatIdentity();
    if (before.length === after.length && before.every((x, i) => x === after[i])) return;
    const trips = await this.layouts.upcomingTripCount(id);
    if (trips === 0) return;
    throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
      message: `${trips} upcoming trip(s) sell seats from this layout, so its seat numbers and seat types cannot change. You can still move seats, the washroom, doors and stairs. To renumber or change seats, duplicate the layout, edit the copy and give it to the bus.`,
    });
  }

  /** Preview endpoint: validate + summarise without persisting. */
  validate(layout: SeatMapProps): SeatMap['summary'] {
    return SeatMap.create(layout).summary;
  }
}
