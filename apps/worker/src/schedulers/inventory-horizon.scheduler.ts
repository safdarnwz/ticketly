import { Injectable } from '@nestjs/common';

import { runInNewContext } from '@kernel';
import { Logger } from '@observability';

import { MaterializationService } from '@api/modules/scheduling';
import { TenantRepository } from '@api/modules/tenancy/infrastructure/persistence/tenant.repository';

/**
 * Rolls every operator's sale horizon forward: trips are created when a
 * service is activated (INVENTORY_HORIZON_DAYS ahead), and without this job
 * nothing would be for sale once those days pass. Idempotent, so running it
 * more often than daily (or after a restart) only creates what is missing.
 * One operator's failure is logged and retried on the next run.
 */
@Injectable()
export class InventoryHorizonScheduler {
  private readonly log: Logger;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly materialization: MaterializationService,
    logger: Logger,
  ) {
    this.log = logger.forContext('InventoryHorizon');
  }

  async run(): Promise<{ tenants: number; trips: number; failures: number }> {
    const tenantIds = await this.tenants.listActiveIds();
    let trips = 0;
    let failures = 0;
    for (const tenantId of tenantIds) {
      try {
        const r = await runInNewContext({ tenantId, actorType: 'system' }, () =>
          this.materialization.materialiseAllActive(),
        );
        trips += r.trips;
        failures += r.failures;
        if (r.trips) this.log.info({ tenantId, ...r }, 'sale horizon extended');
      } catch (err) {
        failures += 1;
        this.log.error({ tenantId, err }, 'horizon run failed for operator — retried next run');
      }
    }
    return { tenants: tenantIds.length, trips, failures };
  }
}
