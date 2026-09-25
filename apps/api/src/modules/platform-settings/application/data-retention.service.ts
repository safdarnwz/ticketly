import { Injectable } from '@nestjs/common';

import { RETENTION_TARGETS, type RetentionKey } from '../domain/data-retention';
import { RetentionPurgeRepository } from '../infrastructure/retention-purge.repository';
import { PlatformPoliciesService } from './platform-policies.service';

/** Most batches one run deletes per table, so a run always finishes. */
const MAX_BATCHES = 40;

/** Applies the data retention policy (#75); run by the worker. */
@Injectable()
export class DataRetentionService {
  constructor(
    private readonly policies: PlatformPoliciesService,
    private readonly purge: RetentionPurgeRepository,
  ) {}

  /** Rows deleted per log table ({} when every table keeps data forever). */
  async run(): Promise<Partial<Record<RetentionKey, number>>> {
    const policy = await this.policies.dataRetention();
    const deleted: Partial<Record<RetentionKey, number>> = {};
    for (const key of Object.keys(RETENTION_TARGETS) as RetentionKey[]) {
      const days = policy[key];
      if (days === null) continue;
      // The floor is re-checked here too: a value stored before the floor existed is never obeyed below it.
      const effective = Math.max(days, RETENTION_TARGETS[key].minDays);
      let total = 0;
      for (let i = 0; i < MAX_BATCHES; i++) {
        const n = await this.purge.purgeBatch(key, effective);
        total += n;
        if (n < this.purge.batchSize) break;
      }
      if (total > 0) deleted[key] = total;
    }
    return deleted;
  }
}
