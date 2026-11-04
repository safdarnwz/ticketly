import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DisbursementService } from './disbursement/disbursement.service';
import { InstantLoanService } from './instant-loan/instant-loan.service';

const enabled = () => process.env.DISABLE_JOBS !== 'true';

@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);
  private polling = false;
  constructor(private readonly disbursal: DisbursementService, private readonly loans: InstantLoanService) {}

  /** Payout confirmations are time-critical for the 5-minute target, so poll every 2 s. */
  @Interval(2000)
  async pollPayouts() {
    if (!enabled() || this.polling) return;
    this.polling = true;
    try { await this.disbursal.pollPending(); } finally { this.polling = false; }
  }

  @Interval(60_000)
  async housekeeping() {
    if (!enabled()) return;
    const expired = await this.loans.expireStale();
    const recon = await this.disbursal.reconcile();
    if (expired || recon.mismatched) this.log.log(`expired=${expired} recon=${JSON.stringify(recon)}`);
  }
}
