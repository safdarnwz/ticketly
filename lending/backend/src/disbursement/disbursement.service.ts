import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThan, MoreThan } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { decryptPii } from '../common/crypto';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { BankAccount } from '../customers/bank-account.entity';
import { Customer } from '../customers/customer.entity';
import { ApplicationStatus, JourneyStep } from '../instant-loan/journey';
import { StepOutcome } from '../instant-loan/journey-event.entity';
import { JourneyRecorder } from '../instant-loan/journey.recorder';
import { LoanApplication } from '../instant-loan/loan-application.entity';
import { Loan, LoanStatus } from '../instant-loan/loan.entity';
import { PAYOUT, PayoutProvider, PayoutResult, RECONCILIATION, ReconciliationProvider } from '../integrations/ports';
import { Disbursement, DisbursementStatus, PayoutRail } from './disbursement.entity';

/** Per-transaction rail limits (paise). Loans here are ₹10k–₹30k, so IMPS is the primary rail. */
export const RAIL_LIMITS: Record<PayoutRail, number> = {
  [PayoutRail.IMPS]: 5_00_000_00,
  [PayoutRail.UPI]: 1_00_000_00,
  [PayoutRail.NEFT]: Number.MAX_SAFE_INTEGER,
};

/** IMPS first (instant, 24x7, to a bank account); NEFT only as a fallback after a confirmed retryable failure. */
export function railPlan(amountPaise: number): PayoutRail[] {
  return [PayoutRail.IMPS, PayoutRail.NEFT].filter((r) => amountPaise <= RAIL_LIMITS[r]);
}

const MAX_ATTEMPTS = 2;

@Injectable()
export class DisbursementService {
  private readonly log = new Logger(DisbursementService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(PAYOUT) private readonly payout: PayoutProvider,
    @Inject(RECONCILIATION) private readonly recon: ReconciliationProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
    private readonly journey: JourneyRecorder,
  ) {}

  /** Creates attempt 1 for a signed loan and sends it to the payout provider. */
  async startForLoan(loanId: string) {
    const loan = await this.ds.getRepository(Loan).findOneByOrFail({ id: loanId });
    const app = await this.ds.getRepository(LoanApplication).findOneByOrFail({ id: loan.applicationId });
    const d = await this.createAttempt(loan, app.bankAccountId!, railPlan(loan.netDisbursalPaise)[0], 1);
    await this.send(d);
  }

  private async createAttempt(loan: Loan, bankAccountId: string, rail: PayoutRail, attempt: number, m?: EntityManager) {
    const r = (m ?? this.ds.manager).getRepository(Disbursement);
    const d = await r.save(
      r.create({
        loanId: loan.id,
        bankAccountId,
        amountPaise: loan.netDisbursalPaise,
        rail,
        attempt,
        idempotencyKey: `${loan.id}:${attempt}`,
        status: DisbursementStatus.INITIATED,
        initiatedAt: new Date(),
      }),
    );
    await this.audit.record({ actorType: 'SYSTEM', action: 'disbursal.attempt_created', entityType: 'disbursement', entityId: d.id, data: { rail, attempt, loanId: loan.id } }, m);
    return d;
  }

  /** Safe to call repeatedly: the provider is idempotent on the attempt's key. */
  private async send(d: Disbursement) {
    const acct = await this.ds.getRepository(BankAccount).findOneByOrFail({ id: d.bankAccountId });
    const customer = await this.ds.getRepository(Customer).findOneByOrFail({ id: acct.customerId });
    let result: PayoutResult;
    try {
      result = await this.payout.initiate({
        idempotencyKey: d.idempotencyKey,
        amountPaise: d.amountPaise,
        rail: d.rail,
        accountNumber: decryptPii(acct.accountNumberEnc, this.cfg.piiEncryptionKey),
        ifsc: acct.ifsc,
        beneficiaryName: acct.bankHolderName ?? customer.fullName ?? '',
        narration: `LOAN ${d.loanId.slice(-12)}`,
      });
    } catch (e) {
      // Outcome unknown (timeout / network). Leave INITIATED; the poller re-sends with the SAME key.
      this.log.warn(`Payout initiate failed for ${d.id}: ${(e as Error).message}`);
      return;
    }
    await this.apply(d.id, result);
  }

  /** Applies a provider result. Row-locked and idempotent, so webhook + poller can race safely. */
  async apply(disbursementId: string, result: PayoutResult) {
    let fallback: Disbursement | null = null;
    await this.ds.transaction(async (m) => {
      const r = m.getRepository(Disbursement);
      const d = await r.findOne({ where: { id: disbursementId }, lock: { mode: 'pessimistic_write' } });
      if (!d || d.status === DisbursementStatus.SUCCESS || d.status === DisbursementStatus.FAILED) return;
      d.providerRef = result.providerRef;
      if (result.state === 'PENDING') {
        d.status = DisbursementStatus.PENDING;
        await r.save(d);
        return;
      }
      const loan = await m.getRepository(Loan).findOne({ where: { id: d.loanId }, lock: { mode: 'pessimistic_write' } });
      const app = await m.getRepository(LoanApplication).findOne({ where: { id: loan!.applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!loan || !app) return;
      d.confirmedAt = new Date();
      if (result.state === 'SUCCESS') {
        d.status = DisbursementStatus.SUCCESS;
        d.utr = result.utr;
        await r.save(d);
        await this.onCredited(m, loan, app, d);
        return;
      }
      d.status = DisbursementStatus.FAILED;
      d.failureCode = result.failureCode;
      await r.save(d);
      await this.audit.record({ actorType: 'PROVIDER', action: 'disbursal.failed', entityType: 'disbursement', entityId: d.id, data: { code: result.failureCode, rail: d.rail } }, m);
      const nextRail = railPlan(d.amountPaise).find((x) => x !== d.rail);
      if (result.retryable && nextRail && d.attempt < MAX_ATTEMPTS) {
        fallback = await this.createAttempt(loan, d.bankAccountId, nextRail, d.attempt + 1, m);
        return;
      }
      loan.status = LoanStatus.CANCELLED;
      await m.getRepository(Loan).save(loan);
      app.status = ApplicationStatus.DISBURSAL_FAILED;
      app.decisionReasons = [...app.decisionReasons, `PAYOUT_${result.failureCode ?? 'FAILED'}`];
      await m.getRepository(LoanApplication).save(app);
      await this.journey.record(m, app, JourneyStep.DISBURSAL, StepOutcome.FAILED, app.esignedAt!.getTime(), { providerRef: result.providerRef, detail: { code: result.failureCode } });
    });
    if (fallback) await this.send(fallback);
  }

  private async onCredited(m: EntityManager, loan: Loan, app: LoanApplication, d: Disbursement) {
    const at = d.confirmedAt!;
    const policy = await m.query(`SELECT "coolingOffDays" FROM pricing_policies WHERE id = $1`, [loan.pricingPolicyId]);
    const day = (n: number) => new Date(at.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    Object.assign(loan, { status: LoanStatus.ACTIVE, disbursedAt: at, dueDate: day(loan.tenureDays), coolingOffEndsOn: day(policy[0]?.coolingOffDays ?? 3) });
    await m.getRepository(Loan).save(loan);
    const elapsed = at.getTime() - app.journeyStartedAt.getTime();
    Object.assign(app, { status: ApplicationStatus.DISBURSED, completedAt: at, totalElapsedMs: elapsed, withinTarget: elapsed <= this.cfg.journeyTargetSeconds * 1000 });
    await m.getRepository(LoanApplication).save(app);
    await this.journey.record(m, app, JourneyStep.DISBURSAL, StepOutcome.PASSED, app.esignedAt!.getTime(), { providerRef: d.providerRef, at: at.getTime(), detail: { rail: d.rail, utr: d.utr, attempt: d.attempt } });
    await this.audit.record({ actorType: 'PROVIDER', action: 'disbursal.credited', entityType: 'loan', entityId: loan.id, data: { utr: d.utr, rail: d.rail, elapsedMs: elapsed } }, m);
  }

  /** Poller: re-sends unconfirmed attempts (same idempotency key) and checks pending ones. */
  async pollPending() {
    const r = this.ds.getRepository(Disbursement);
    const items = await r.find({ where: { status: In([DisbursementStatus.INITIATED, DisbursementStatus.PENDING]) }, take: 100, order: { initiatedAt: 'ASC' } });
    for (const d of items) {
      try {
        if (d.status === DisbursementStatus.INITIATED || !d.providerRef) await this.send(d);
        else await this.apply(d.id, await this.payout.status(d.providerRef));
      } catch (e) {
        this.log.error(`Polling ${d.id} failed: ${(e as Error).message}`);
      }
    }
    return items.length;
  }

  /** Webhook: never trust the body alone, confirm with the provider's status API. */
  async onWebhook(providerRef: string) {
    const d = await this.ds.getRepository(Disbursement).findOne({ where: { providerRef } });
    if (!d) return { matched: false };
    await this.apply(d.id, await this.payout.status(providerRef));
    return { matched: true };
  }

  /** Matches successful payouts against the bank / provider settlement feed. */
  async reconcile() {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const entries = await this.recon.settledPayouts(since);
    const r = this.ds.getRepository(Disbursement);
    let matched = 0, mismatched = 0;
    for (const e of entries) {
      const d = await r.findOne({ where: { providerRef: e.providerRef, reconciledAt: IsNull() } });
      if (!d) continue;
      if (d.status === DisbursementStatus.SUCCESS && d.amountPaise === e.amountPaise && (!d.utr || d.utr === e.utr)) {
        await r.update({ id: d.id }, { reconciledAt: new Date(), utr: e.utr });
        matched++;
      } else {
        mismatched++;
        await this.audit.record({ actorType: 'SYSTEM', action: 'recon.mismatch', entityType: 'disbursement', entityId: d.id, data: { ...e, ourStatus: d.status, ourAmount: d.amountPaise } });
      }
    }
    const unreconciledOld = await r.count({ where: { status: DisbursementStatus.SUCCESS, reconciledAt: IsNull(), confirmedAt: LessThan(new Date(Date.now() - 86_400_000)) } });
    return { matched, mismatched, unreconciledOlderThan24h: unreconciledOld };
  }

  listRecent(hours = 24) {
    return this.ds.getRepository(Disbursement).find({ where: { createdAt: MoreThan(new Date(Date.now() - hours * 3_600_000)) }, order: { createdAt: 'DESC' }, take: 200 });
  }
}
