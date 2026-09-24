import { Injectable } from '@nestjs/common';

import { runInNewContext } from '@kernel';
import { Logger } from '@observability';

import { SettlementService } from '@api/modules/payment/application/services/settlement.service';
import { TenantRepository } from '@api/modules/tenancy/infrastructure/persistence/tenant.repository';
import { payoutWindowFor } from '@api/modules/payment/domain/payout-schedule';

/**
 * ============================================================================
 *  Automated payout — twice a week, every operator, no manual trigger needed
 * ============================================================================
 *
 *   Mon/Tue/Wed bookings  → paid out Thursday
 *   Thu/Fri/Sat/Sun bookings → paid out the following Monday
 *
 * Runs once a day (see SchedulerService); `payoutWindowFor` returns null on
 * every day except Mon/Thu, so most runs are a no-op. Safe to run more than
 * once on a payout day (or even re-run after a crash mid-cycle) — every step
 * is idempotent: SettlementService.generate reuses the existing settlement
 * for a (tenant, period) instead of creating a second one (enforced at the
 * DB level too — migration 0022's unique index), and finalise() no-ops on a
 * settlement that isn't still 'draft'.
 *
 * One operator's failure (a locked row, a transient DB error) is logged and
 * skipped — it does NOT stop every other operator's payout from running that
 * day. It's picked up on the NEXT scheduled run (still idempotent) rather
 * than needing a separate retry path.
 */
@Injectable()
export class PayoutScheduler {
  private readonly log: Logger;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly settlement: SettlementService,
    logger: Logger,
  ) {
    this.log = logger.forContext('PayoutScheduler');
  }

  async runIfDue(
    now: Date = new Date(),
  ): Promise<{ ran: boolean; tenants: number; failures: number }> {
    const window = payoutWindowFor(now);
    if (!window) return { ran: false, tenants: 0, failures: 0 };

    const tenantIds = await this.tenants.listActiveIds();
    let failures = 0;

    for (const tenantId of tenantIds) {
      try {
        // A fresh context per tenant — this is a background job, not an HTTP
        // request, so there's no ambient context to extend (runAsTenant
        // would throw); runInNewContext creates one from scratch, scoped to
        // just this tenant and this async call.
        const result = await runInNewContext({ tenantId, actorType: 'system' }, () =>
          this.settlement.runPayout(window.periodFrom, window.periodTo),
        );
        this.log.info(
          { tenantId, ...result, periodFrom: window.periodFrom, periodTo: window.periodTo },
          'payout settled',
        );
      } catch (err) {
        failures += 1;
        this.log.error(
          { tenantId, err, periodFrom: window.periodFrom, periodTo: window.periodTo },
          'payout failed for operator — will retry on next scheduled run',
        );
      }
    }

    return { ran: true, tenants: tenantIds.length, failures };
  }
}
