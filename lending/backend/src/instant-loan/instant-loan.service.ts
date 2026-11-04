import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Not } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CustomerPrincipal, StaffPrincipal } from '../auth/auth.types';
import { decryptPii, encryptPii, hmacHash } from '../common/crypto';
import { rupeesToPaise } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { BankAccount } from '../customers/bank-account.entity';
import { Customer } from '../customers/customer.entity';
import { Disbursement } from '../disbursement/disbursement.entity';
import { DisbursementService } from '../disbursement/disbursement.service';
import {
  BANK_VERIFICATION, BankVerificationProvider, CKYC, CkycProvider, CREDIT_BUREAU, CreditBureauProvider, ESIGN, EsignProvider, PAN_KYC, PanKycProvider,
} from '../integrations/ports';
import { freezeOffer } from '../pricing/offer';
import { PricingPlan } from '../pricing/pricing-plan.entity';
import { PricingService } from '../pricing/pricing.service';
import { AcceptKfsDto, AssessmentDto, BankAccountDto, KycDto, ReviewDto } from './dto';
import { ApplicationStatus as S, canTransition, JourneyStep, STEP_TARGETS } from './journey';
import { JourneyEvent, StepOutcome } from './journey-event.entity';
import { JourneyRecorder } from './journey.recorder';
import { buildKfs, kfsHash, KeyFactStatement } from './kfs';
import { LoanApplication } from './loan-application.entity';
import { Loan, LoanStatus } from './loan.entity';
import { assessRisk, DEFAULT_RISK_POLICY, nameSimilarity } from './risk.engine';

const OPEN_STATUSES = [S.STARTED, S.KYC_VERIFIED, S.BANK_VERIFIED, S.MANUAL_REVIEW, S.APPROVED, S.KFS_ACCEPTED, S.ESIGN_PENDING, S.DISBURSING];

@Injectable()
export class InstantLoanService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(PAN_KYC) private readonly panKyc: PanKycProvider,
    @Inject(CKYC) private readonly ckyc: CkycProvider,
    @Inject(CREDIT_BUREAU) private readonly bureau: CreditBureauProvider,
    @Inject(BANK_VERIFICATION) private readonly bank: BankVerificationProvider,
    @Inject(ESIGN) private readonly esign: EsignProvider,
    private readonly pricing: PricingService,
    private readonly disbursal: DisbursementService,
    private readonly journey: JourneyRecorder,
    private readonly audit: AuditService,
  ) {}

  // ---------- helpers ----------

  /** Locks the application row for the whole step so double-clicks cannot run a step twice. */
  private withApp<T>(id: string, user: CustomerPrincipal, expected: S[], fn: (m: EntityManager, app: LoanApplication) => Promise<T>) {
    return this.ds.transaction(async (m) => {
      const app = await m.getRepository(LoanApplication).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!app || app.customerId !== user.sub) throw new NotFoundException('Application not found');
      if (!expected.includes(app.status)) throw new ConflictException(`This step is not allowed while the application is ${app.status}`);
      return fn(m, app);
    });
  }

  private async move(m: EntityManager, app: LoanApplication, to: S, actor: { type: 'CUSTOMER' | 'STAFF' | 'SYSTEM'; id: string | null }, data: Record<string, unknown> = {}) {
    if (!canTransition(app.status, to)) throw new ConflictException(`Cannot move from ${app.status} to ${to}`);
    const from = app.status;
    app.status = to;
    await m.getRepository(LoanApplication).save(app);
    await this.audit.record({ actorType: actor.type, actorId: actor.id, action: `application.${to.toLowerCase()}`, entityType: 'loan_application', entityId: app.id, data: { from, ...data } }, m);
  }

  private customerActor = (u: CustomerPrincipal) => ({ type: 'CUSTOMER' as const, id: u.sub });

  private ensureOfferValid(app: LoanApplication) {
    if (!app.offerExpiresAt || app.offerExpiresAt < new Date()) throw new GoneException('This offer has expired. Please start a new application.');
  }

  private async makeOffer(m: EntityManager, app: LoanApplication, principalPaise: number, plan: PricingPlan) {
    const offer = freezeOffer(plan, principalPaise);
    if (plan.aprCapPercent != null && offer.aprBps / 100 > plan.aprCapPercent) throw new UnprocessableEntityException('Offer is above the owner-set APR cap');
    app.offer = offer;
    app.pricingPlanId = plan.id;
    app.offerExpiresAt = new Date(Date.now() + this.cfg.offerValidityMinutes * 60_000);
    app.kfsHash = kfsHash(await this.buildKfsFor(m, app));
  }

  /** Built only from the frozen offer, never from the live plan. */
  private async buildKfsFor(m: EntityManager, app: LoanApplication): Promise<KeyFactStatement> {
    const customer = await m.getRepository(Customer).findOneByOrFail({ id: app.customerId });
    const acct = await m.getRepository(BankAccount).findOneByOrFail({ id: app.bankAccountId! });
    return buildKfs({
      applicationId: app.id,
      lender: this.cfg.lenderName,
      grievanceOfficer: this.cfg.grievanceOfficer,
      generatedAt: new Date(app.offerExpiresAt!.getTime() - this.cfg.offerValidityMinutes * 60_000),
      validUntil: app.offerExpiresAt!,
      borrower: { name: customer.fullName!, mobile: customer.mobile, panMasked: customer.panMasked! },
      bank: { last4: acct.accountLast4, ifsc: acct.ifsc },
      offer: app.offer!,
    });
  }

  // ---------- 00:00 OTP login → start ----------

  async start(user: CustomerPrincipal, ip: string | null, deviceId: string | null) {
    const repo = this.ds.getRepository(LoanApplication);
    const open = await repo.findOne({ where: { customerId: user.sub, status: In(OPEN_STATUSES) }, order: { createdAt: 'DESC' } });
    if (open) return this.status(open.id, user);
    await this.pricing.resolve(user.mobile); // fail fast if lending is paused
    return this.ds.transaction(async (m) => {
      const r = m.getRepository(LoanApplication);
      // t = 0 is when the customer asked for the OTP, so the login step itself is timed.
      const app = await r.save(r.create({ customerId: user.sub, journeyStartedAt: new Date(user.loginAt - user.otpMs), clientIp: ip, deviceId }));
      await this.journey.record(m, app, JourneyStep.OTP_LOGIN, StepOutcome.PASSED, user.loginAt - user.otpMs, { at: user.loginAt });
      await this.audit.record({ actorType: 'CUSTOMER', actorId: user.sub, action: 'application.started', entityType: 'loan_application', entityId: app.id, data: { ip, deviceId } }, m);
      return { id: app.id, status: app.status, journeyStartedAt: app.journeyStartedAt };
    });
  }

  // ---------- 00:30 KYC ----------

  async kyc(id: string, user: CustomerPrincipal, dto: KycDto) {
    return this.withApp(id, user, [S.STARTED], async (m, app) => {
      const t = Date.now();
      const consentRef = `kyc-consent:${app.id}:${t}`;
      // PAN check and CKYC download run in parallel to save time.
      const [pan, ck] = await Promise.all([this.panKyc.verifyPan(dto.pan, dto.fullName, dto.dateOfBirth), this.ckyc.searchAndDownload(dto.pan, dto.dateOfBirth, consentRef)]);
      const nameScore = pan.nameOnPan ? nameSimilarity(dto.fullName, pan.nameOnPan) : 0;
      const ok = pan.valid && nameScore >= 0.9;
      await this.journey.record(m, app, JourneyStep.KYC, ok ? StepOutcome.PASSED : StepOutcome.FAILED, t, { providerRef: pan.ref, detail: { panStatus: pan.panStatus, ckycFound: ck.found, nameScore } });
      if (!ok) {
        app.decisionReasons = [pan.valid ? 'KYC_NAME_MISMATCH' : 'KYC_PAN_INVALID'];
        await this.move(m, app, S.REJECTED, this.customerActor(user));
        return { status: app.status, reasons: app.decisionReasons };
      }
      const customers = m.getRepository(Customer);
      const c = await customers.findOneByOrFail({ id: user.sub });
      Object.assign(c, {
        fullName: pan.nameOnPan,
        panHash: hmacHash(dto.pan, this.cfg.piiHashPepper),
        panEnc: encryptPii(dto.pan, this.cfg.piiEncryptionKey),
        panMasked: `${dto.pan.slice(0, 2)}XXXXX${dto.pan.slice(7)}`,
        dateOfBirth: dto.dateOfBirth,
        ckycNumber: ck.ckycNumber,
        kycVerifiedAt: new Date(),
      });
      await customers.save(c);
      await this.move(m, app, S.KYC_VERIFIED, this.customerActor(user), { consentRef });
      return { status: app.status, name: c.fullName };
    });
  }

  // ---------- 01:30 Bank account verification ----------

  async bankAccount(id: string, user: CustomerPrincipal, dto: BankAccountDto) {
    return this.withApp(id, user, [S.KYC_VERIFIED], async (m, app) => {
      const t = Date.now();
      const c = await m.getRepository(Customer).findOneByOrFail({ id: user.sub });
      const v = await this.bank.validateAccount(dto.accountNumber, dto.ifsc, c.fullName!);
      const score = v.registeredName ? nameSimilarity(c.fullName!, v.registeredName) : 0;
      const ok = v.accountExists && v.accountActive && score >= DEFAULT_RISK_POLICY.minNameMatch;
      await this.journey.record(m, app, JourneyStep.BANK_VERIFICATION, ok ? StepOutcome.PASSED : StepOutcome.FAILED, t, { providerRef: v.ref, detail: { exists: v.accountExists, nameScore: score } });
      if (!v.accountExists || !v.accountActive) throw new UnprocessableEntityException('This account could not be verified. Check the number and IFSC, or use another account.');
      if (!ok) throw new UnprocessableEntityException('This bank account is not in your name. Loans can only be sent to your own account.');
      const accounts = m.getRepository(BankAccount);
      const hash = hmacHash(dto.accountNumber, this.cfg.piiHashPepper);
      let acct = await accounts.findOne({ where: { customerId: c.id, accountHash: hash } });
      if (!acct) acct = accounts.create({ customerId: c.id, accountHash: hash, accountNumberEnc: encryptPii(dto.accountNumber, this.cfg.piiEncryptionKey), accountLast4: dto.accountNumber.slice(-4), ifsc: dto.ifsc });
      Object.assign(acct, { ifsc: dto.ifsc, bankHolderName: v.registeredName, nameMatchScore: score, verificationRef: v.ref, verifiedAt: new Date() });
      await accounts.save(acct);
      app.bankAccountId = acct.id;
      await this.move(m, app, S.BANK_VERIFIED, this.customerActor(user), { bankAccountId: acct.id });
      return { status: app.status, accountLast4: acct.accountLast4, nameMatchScore: score };
    });
  }

  // ---------- 02:30 Credit & risk → 03:30 approval ----------

  async assess(id: string, user: CustomerPrincipal, dto: AssessmentDto) {
    return this.withApp(id, user, [S.BANK_VERIFIED], async (m, app) => {
      const t = Date.now();
      const c = await m.getRepository(Customer).findOneByOrFail({ id: user.sub });
      const plan = await this.pricing.resolve(c.mobile, new Date(), m);
      const requested = rupeesToPaise(dto.requestedAmount);
      if (requested < plan.minPrincipalPaise || requested > plan.maxPrincipalPaise)
        throw new BadRequestException(`Loan amount must be between ₹${plan.minPrincipalPaise / 100} and ₹${plan.maxPrincipalPaise / 100}`);
      const acct = await m.getRepository(BankAccount).findOneByOrFail({ id: app.bankAccountId! });
      const consentRef = `bureau-consent:${app.id}:${t}`;
      const since = new Date(Date.now() - 86_400_000);
      const appRepo = m.getRepository(LoanApplication);
      const [report, ipCount, devCount, dupPan, otherOpen, activeLoans] = await Promise.all([
        this.bureau.pullReport({ pan: decryptPii(c.panEnc!, this.cfg.piiEncryptionKey), name: c.fullName!, dob: c.dateOfBirth!, mobile: c.mobile, consentRef }).catch(() => null),
        app.clientIp ? appRepo.count({ where: { clientIp: app.clientIp, createdAt: MoreThan(since) } }) : 0,
        app.deviceId ? appRepo.count({ where: { deviceId: app.deviceId, createdAt: MoreThan(since) } }) : 0,
        m.getRepository(Customer).exist({ where: { panHash: c.panHash!, id: Not(c.id) } }),
        appRepo.count({ where: { customerId: c.id, status: In(OPEN_STATUSES), id: Not(app.id) } }),
        m.getRepository(Loan).count({ where: { customerId: c.id, status: In([LoanStatus.ACTIVE, LoanStatus.PENDING_DISBURSAL]) } }),
      ]);
      if (!report) {
        await this.journey.record(m, app, JourneyStep.CREDIT_RISK, StepOutcome.FAILED, t, { detail: { error: 'BUREAU_UNAVAILABLE' } });
        throw new UnprocessableEntityException('Credit bureau is not responding. Please try again in a minute.');
      }
      const age = Math.floor((Date.now() - new Date(c.dateOfBirth!).getTime()) / (365.25 * 86_400_000));
      const risk = assessRisk(
        {
          ageYears: age,
          monthlyIncomePaise: rupeesToPaise(dto.monthlyIncome),
          existingEmiPaise: rupeesToPaise(dto.existingMonthlyEmi),
          requestedPrincipalPaise: requested,
          employmentType: dto.employmentType,
          bureau: report,
          nameMatchScore: acct.nameMatchScore ?? 0,
          applicationsFromIpLast24h: ipCount,
          applicationsFromDeviceLast24h: devCount,
          panUsedByOtherCustomer: dupPan,
          openApplicationsForCustomer: otherOpen + activeLoans,
        },
        plan,
        plan,
      );
      Object.assign(app, {
        requestedPrincipalPaise: requested,
        declaredMonthlyIncomePaise: rupeesToPaise(dto.monthlyIncome),
        employmentType: dto.employmentType,
        bureauScore: report.score,
        decisionReasons: risk.reasons,
      });
      const outcome = risk.decision === 'APPROVE' ? StepOutcome.PASSED : risk.decision === 'REJECT' ? StepOutcome.FAILED : StepOutcome.REFERRED;
      await this.journey.record(m, app, JourneyStep.CREDIT_RISK, outcome, t, { providerRef: report.reportRef, detail: { score: report.score, reasons: risk.reasons } });
      if (risk.decision === 'REJECT') {
        await this.move(m, app, S.REJECTED, this.customerActor(user), { reasons: risk.reasons });
        return { status: app.status, reasons: risk.reasons };
      }
      if (risk.decision === 'MANUAL_REVIEW') {
        await this.move(m, app, S.MANUAL_REVIEW, this.customerActor(user), { reasons: risk.reasons });
        return { status: app.status, reasons: risk.reasons, message: 'Your application needs a quick review by our credit team. We will notify you by SMS.' };
      }
      const ta = Date.now();
      await this.makeOffer(m, app, risk.approvedPrincipalPaise, plan);
      await this.move(m, app, S.APPROVED, { type: 'SYSTEM', id: null }, { principal: risk.approvedPrincipalPaise, planId: plan.id });
      await this.journey.record(m, app, JourneyStep.APPROVAL, StepOutcome.PASSED, ta, { detail: { approvedPaise: risk.approvedPrincipalPaise, aprBps: app.offer!.aprBps } });
      return { status: app.status, offer: app.offer, offerExpiresAt: app.offerExpiresAt, reasons: risk.reasons };
    });
  }

  // ---------- 04:00 KFS & e-sign ----------

  async kfs(id: string, user: CustomerPrincipal) {
    const app = await this.ds.getRepository(LoanApplication).findOneBy({ id });
    if (!app || app.customerId !== user.sub) throw new NotFoundException();
    if (!app.offer) throw new ConflictException('No offer yet');
    const kfs = await this.buildKfsFor(this.ds.manager, app);
    return { kfs, kfsHash: kfsHash(kfs) };
  }

  async acceptKfs(id: string, user: CustomerPrincipal, dto: AcceptKfsDto) {
    return this.withApp(id, user, [S.APPROVED], async (m, app) => {
      this.ensureOfferValid(app);
      if (dto.kfsHash !== app.kfsHash) throw new ConflictException('The KFS has changed. Please reload and review it again.');
      app.kfsAcceptedAt = new Date();
      await this.move(m, app, S.KFS_ACCEPTED, this.customerActor(user), { kfsHash: app.kfsHash });
      return { status: app.status };
    });
  }

  async esignInitiate(id: string, user: CustomerPrincipal) {
    return this.withApp(id, user, [S.KFS_ACCEPTED, S.ESIGN_PENDING], async (m, app) => {
      this.ensureOfferValid(app);
      if (app.status === S.ESIGN_PENDING && app.esignRequestId) return { status: app.status, requestId: app.esignRequestId, signingUrl: null };
      const c = await m.getRepository(Customer).findOneByOrFail({ id: user.sub });
      const r = await this.esign.initiate({ documentHash: app.kfsHash!, signerName: c.fullName!, mobile: c.mobile });
      app.esignRequestId = r.requestId;
      await this.move(m, app, S.ESIGN_PENDING, this.customerActor(user), { requestId: r.requestId });
      return { status: app.status, requestId: r.requestId, signingUrl: r.signingUrl, ...(this.cfg.integrationsMode === 'sandbox' && { sandboxOtp: '123456' }) };
    });
  }

  /** Signing triggers the payout immediately: this is where the 5-minute promise is kept. */
  async esignComplete(id: string, user: CustomerPrincipal, otp: string) {
    const loanId = await this.withApp(id, user, [S.ESIGN_PENDING], async (m, app) => {
      this.ensureOfferValid(app);
      const t = app.kfsAcceptedAt!.getTime();
      const r = await this.esign.complete(app.esignRequestId!, otp);
      if (!r.signed) throw new UnprocessableEntityException('E-sign failed. Check the OTP and try again.');
      await this.pricing.consume(m, app.pricingPlanId!);
      app.signedAgreementRef = r.signedDocumentRef;
      app.esignedAt = new Date();
      await this.journey.record(m, app, JourneyStep.KFS_ESIGN, StepOutcome.PASSED, t, { providerRef: app.esignRequestId });
      const o = app.offer!;
      const loans = m.getRepository(Loan);
      const loan = await loans.save(
        loans.create({
          applicationId: app.id,
          customerId: app.customerId,
          pricingPlanId: app.pricingPlanId!,
          principalPaise: o.principalPaise,
          processingFeePaise: o.processingFeePaise,
          gstOnFeePaise: o.gstOnFeePaise,
          netDisbursalPaise: o.netDisbursalPaise,
          interestPaise: o.interestPaise,
          totalRepayablePaise: o.totalRepayablePaise,
          aprBps: o.aprBps,
          tenureDays: o.tenureDays,
        }),
      );
      await this.move(m, app, S.DISBURSING, this.customerActor(user), { loanId: loan.id, agreement: r.signedDocumentRef });
      return loan.id;
    });
    await this.disbursal.startForLoan(loanId);
    return this.status(id, user);
  }

  // ---------- status / timeline ----------

  async status(id: string, user: CustomerPrincipal | null) {
    const app = await this.ds.getRepository(LoanApplication).findOneBy({ id });
    if (!app || (user && app.customerId !== user.sub)) throw new NotFoundException();
    const events = await this.ds.getRepository(JourneyEvent).find({ where: { applicationId: id }, order: { createdAt: 'ASC' } });
    const loan = await this.ds.getRepository(Loan).findOneBy({ applicationId: id });
    const payouts = loan ? await this.ds.getRepository(Disbursement).find({ where: { loanId: loan.id }, order: { attempt: 'ASC' } }) : [];
    const end = app.completedAt?.getTime() ?? Date.now();
    return {
      id: app.id,
      status: app.status,
      journeyStartedAt: app.journeyStartedAt,
      elapsedMs: end - app.journeyStartedAt.getTime(),
      targetMs: this.cfg.journeyTargetSeconds * 1000,
      withinTarget: app.withinTarget,
      reasons: app.decisionReasons,
      offer: app.offer,
      offerExpiresAt: app.offerExpiresAt,
      steps: STEP_TARGETS.map((s) => {
        const e = [...events].reverse().find((x) => x.step === s.step);
        return { ...s, outcome: e?.outcome ?? null, durationMs: e?.durationMs ?? null, elapsedMs: e?.elapsedMs ?? null, onTime: e ? e.elapsedMs <= e.targetCompleteByMs : null };
      }),
      loan: loan && { id: loan.id, status: loan.status, netDisbursalPaise: loan.netDisbursalPaise, totalRepayablePaise: loan.totalRepayablePaise, dueDate: loan.dueDate, coolingOffEndsOn: loan.coolingOffEndsOn, disbursedAt: loan.disbursedAt },
      payouts: payouts.map((p) => ({ attempt: p.attempt, rail: p.rail, status: p.status, utr: p.utr, failureCode: p.failureCode, initiatedAt: p.initiatedAt, confirmedAt: p.confirmedAt })),
    };
  }

  // ---------- staff: manual review ----------

  listForReview() {
    return this.ds.getRepository(LoanApplication).find({ where: { status: S.MANUAL_REVIEW }, order: { createdAt: 'ASC' }, take: 200 });
  }

  async review(id: string, staff: StaffPrincipal, dto: ReviewDto) {
    return this.ds.transaction(async (m) => {
      const app = await m.getRepository(LoanApplication).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException();
      if (app.status !== S.MANUAL_REVIEW) throw new ConflictException('Application is not waiting for review');
      app.reviewedBy = staff.sub;
      const actor = { type: 'STAFF' as const, id: staff.sub };
      if (dto.decision === 'REJECT') {
        app.decisionReasons = [...app.decisionReasons, 'UNDERWRITER_REJECTED'];
        await this.move(m, app, S.REJECTED, actor, { note: dto.note });
        return { status: app.status };
      }
      const customer = await m.getRepository(Customer).findOneByOrFail({ id: app.customerId });
      const plan = await this.pricing.resolve(customer.mobile, new Date(), m);
      const amount = dto.approvedAmount ? rupeesToPaise(dto.approvedAmount) : app.requestedPrincipalPaise!;
      if (amount > app.requestedPrincipalPaise! || amount < plan.minPrincipalPaise || amount > plan.maxPrincipalPaise)
        throw new BadRequestException('Approved amount must be within the plan limits and not above the requested amount');
      const t = Date.now();
      await this.makeOffer(m, app, amount, plan);
      await this.move(m, app, S.APPROVED, actor, { note: dto.note, principal: amount });
      await this.journey.record(m, app, JourneyStep.APPROVAL, StepOutcome.PASSED, t, { detail: { manual: true, reviewer: staff.sub } });
      return { status: app.status, offer: app.offer };
    });
  }

  /** Abandoned journeys expire so stale offers can never be signed later. */
  async expireStale() {
    const cutoff = new Date(Date.now() - 30 * 60_000);
    const reviewCutoff = new Date(Date.now() - 48 * 3_600_000);
    const r = await this.ds.query(
      `UPDATE loan_applications SET status = 'EXPIRED', "updatedAt" = now()
        WHERE (status IN ('STARTED','KYC_VERIFIED','BANK_VERIFIED','APPROVED','KFS_ACCEPTED','ESIGN_PENDING') AND "updatedAt" < $1)
           OR (status = 'MANUAL_REVIEW' AND "updatedAt" < $2)
        RETURNING id`,
      [cutoff, reviewCutoff],
    );
    return (r[0] as unknown[])?.length ?? 0;
  }

  assertOwnership(app: LoanApplication, user: CustomerPrincipal) {
    if (app.customerId !== user.sub) throw new ForbiddenException();
  }
}
