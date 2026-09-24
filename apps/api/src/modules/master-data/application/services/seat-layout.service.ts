import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { getUserId, requireTenantId, type SeatLayoutId } from '@kernel';

import { SeatMap, type SeatMapProps } from '../../seat-layout/domain/seat-map';
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
    if (!version) throw new Error(`Version ${versionNumber} not found`);
    const seatMap = SeatMap.create(version.layout as SeatMapProps);
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

  /** Preview endpoint: validate + summarise without persisting. */
  validate(layout: SeatMapProps): SeatMap['summary'] {
    return SeatMap.create(layout).summary;
  }
}
