import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DisbursementService } from './disbursement/disbursement.service';
import { InstantLoanService } from './instant-loan/instant-loan.service';
import { RepaymentService } from './repayment/repayment.service';

const enabled = () => process.env.DISABLE_JOBS !== 'true';

@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);
  private polling = false;
  constructor(private readonly disbursal: DisbursementService, private readonly loans: InstantLoanService, private readonly repayments: RepaymentService) {}

  /** Payout confirmations are time-critical for the 5-minute target, so poll every 2 s. */
  @Interval(2000)
  async pollPayouts() {
    if (!enabled() || this.polling) return;
    this.polling = true;
    try { await this.disbursal.pollPending(); } finally { this.polling = false; }
  }

  /** Repayments are customer-initiated (no eNACH), so confirm them quickly. */
  @Interval(5000)
  async pollRepayments() {
    if (!enabled()) return;
    await this.repayments.pollOpenPayments();
  }

  @Interval(60_000)
  async housekeeping() {
    if (!enabled()) return;
    const expired = await this.loans.expireStale();
    const recon = await this.disbursal.reconcile();
    const overdue = await this.repayments.accrueOverdue();
    const reminders = await this.repayments.sendReminders();
    if (expired || recon.mismatched || reminders) this.log.log(`expired=${expired} recon=${JSON.stringify(recon)} overdue=${overdue} reminders=${reminders}`);
  }
}
