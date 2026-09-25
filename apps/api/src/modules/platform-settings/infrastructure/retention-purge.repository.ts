import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';

import { RETENTION_TARGETS, type RetentionKey } from '../domain/data-retention';

const BATCH = 5_000;

/**
 * Deletes rows older than the retention policy allows (#75), across every
 * tenant. Batched (by `tableoid, ctid`, which is unique across the partitions
 * of a partitioned table) so a first run over years of GPS pings never holds
 * one huge lock.
 */
@Injectable()
export class RetentionPurgeRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** One batch; returns how many rows went. The table/column come from RETENTION_TARGETS, never input. */
  async purgeBatch(key: RetentionKey, days: number): Promise<number> {
    const { table, column } = RETENTION_TARGETS[key];
    return this.uow.run({ name: `retention.purge.${key}`, bypassRls: true }, async (scope) => {
      const result = await scope.client.query(
        `DELETE FROM ${table}
          WHERE (tableoid, ctid) IN (
            SELECT tableoid, ctid FROM ${table}
             WHERE ${column} < now() - make_interval(days => $1::int)
             LIMIT ${BATCH})`,
        [days],
      );
      return result.rowCount ?? 0;
    });
  }

  readonly batchSize = BATCH;
}
