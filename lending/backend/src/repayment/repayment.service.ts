import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, MoreThan } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CustomerPrincipal } from '../auth/auth.types';
import { formatInr } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { Customer } from '../customers/customer.entity';
import { Loan, LoanStatus } from '../instant-loan/loan.entity';
import { PAYMENT_GATEWAY, PaymentGatewayProvider, PaymentStatus } from '../integrations/ports';
import { addDays, dues, Dues, inContactWindow, istDate, LoanTerms, penalForOneDay, REMINDERS } from './loan.math';
import { NotifierService } from './notifier.service';
import { Repayment, RepaymentStatus } from './repayment.entity';

const OPEN = [LoanStatus.ACTIVE, LoanStatus.OVERDUE];
const MIN_PAYMENT_PAISE = 100_00;
const ORDER_MINUTES = 30;

@Injectable()
export class RepaymentService {
  private readonly log = new Logger(RepaymentService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly notifier: NotifierService,
    private readonly audit: AuditService,
  ) {}

  static terms(l: Loan): LoanTerms {
    return {
      principalPaise: l.principalPaise, interestPaise: l.interestPaise, totalRepayablePaise: l.totalRepayablePaise, tenureDays: l.tenureDays,
      disbursedOn: istDate(l.disbursedAt!), dueDate: l.dueDate!, coolingOffEndsOn: l.coolingOffEndsOn,
      paidPaise: l.paidPaise, penalAccruedPaise: l.penalAccruedPaise, penalType: l.penalType, penalValue: l.penalValue,
    };
  }

  duesOf(l: Loan, today = istDate()): Dues | null {
    return l.disbursedAt && l.dueDate ? dues(RepaymentService.terms(l), today) : null;
  }

  private view(l: Loan, today?: string) {
    return {
      id: l.id, status: l.status, principalPaise: l.principalPaise, netDisbursalPaise: l.netDisbursalPaise, totalRepayablePaise: l.totalRepayablePaise,
      disbursedAt: l.disbursedAt, dueDate: l.dueDate, coolingOffEndsOn: l.coolingOffEndsOn, closedAt: l.closedAt, aprBps: l.aprBps,
      penalType: l.penalType, penalValue: l.penalValue,
      dues: this.duesOf(l, today),
    };
  }

  // ---------- customer ----------

  async myLoans(user: CustomerPrincipal) {
    const loans = await this.ds.getRepository(Loan).find({ where: { customerId: user.sub, status: In([...OPEN, LoanStatus.CLOSED]) }, order: { createdAt: 'DESC' } });
    return loans.map((l) => this.view(l));
  }

  private async ownLoan(id: string, user: CustomerPrincipal) {
    const l = await this.ds.getRepository(Loan).findOneBy({ id });
    if (!l || l.customerId !== user.sub) throw new NotFoundException('Loan not found');
    return l;
  }

  async loanDetail(id: string, user: CustomerPrincipal) {
    const l = await this.ownLoan(id, user);
    const payments = await this.ds.getRepository(Repayment).find({ where: { loanId: id }, order: { createdAt: 'DESC' } });
    return {
      ...this.view(l),
      payments: payments.map((p) => ({ id: p.id, status: p.status, amountPaise: p.amountPaise, paidPaise: p.paidPaise, method: p.method, utr: p.utr, paidAt: p.paidAt, receiptNo: p.receiptNo, paymentUrl: p.status === 'CREATED' ? p.paymentUrl : null })),
      howToPay: 'UPI, net banking or debit card. No auto-debit is set up on your account.',
    };
  }

  /** Starts a payment the customer completes on the gateway page or in their UPI app. */
  async createPayment(loanId: string, user: CustomerPrincipal, amountRupees?: number) {
    const l = await this.ownLoan(loanId, user);
    if (!OPEN.includes(l.status)) throw new ConflictException('This loan has no amount due');
    const d = this.duesOf(l)!;
    const amount = amountRupees === undefined ? d.outstandingPaise : Math.round(amountRupees * 100);
    if (amount > d.outstandingPaise) throw new BadRequestException(`You owe ${formatInr(d.outstandingPaise)} today. Enter that amount or less.`);
    if (amount < Math.min(MIN_PAYMENT_PAISE, d.outstandingPaise)) throw new BadRequestException('Minimum payment is ₹100');
    const c = await this.ds.getRepository(Customer).findOneByOrFail({ id: user.sub });
    const repo = this.ds.getRepository(Repayment);
    const p = await repo.save(repo.create({ loanId, customerId: user.sub, amountPaise: amount, expiresAt: new Date(Date.now() + ORDER_MINUTES * 60_000) }));
    const order = await this.gateway.createOrder({ reference: p.id, amountPaise: amount, mobile: c.mobile, name: c.fullName ?? '', description: `Loan repayment ${loanId.slice(-8)}`, expiresInMinutes: ORDER_MINUTES });
    Object.assign(p, { orderId: order.orderId, paymentUrl: order.paymentUrl, upiIntentUrl: order.upiIntentUrl });
    await repo.save(p);
    await this.audit.record({ actorType: 'CUSTOMER', actorId: user.sub, action: 'repayment.started', entityType: 'loan', entityId: loanId, data: { repaymentId: p.id, amount } });
    return { paymentId: p.id, amountPaise: amount, paymentUrl: order.paymentUrl, upiIntentUrl: order.upiIntentUrl, expiresAt: p.expiresAt };
  }

  async refreshPayment(loanId: string, paymentId: string, user: CustomerPrincipal) {
    await this.ownLoan(loanId, user);
    const p = await this.ds.getRepository(Repayment).findOneBy({ id: paymentId, loanId });
    if (!p) throw new NotFoundException();
    if (p.status === RepaymentStatus.CREATED && p.orderId) await this.apply(p.id, await this.gateway.status(p.orderId));
    return this.loanDetail(loanId, user);
  }

  // ---------- confirmation (webhook, poller, customer refresh) ----------

  /** Row-locked and idempotent: a payment is counted exactly once. */
  async apply(repaymentId: string, st: PaymentStatus) {
    const result = await this.ds.transaction(async (m) => {
      const p = await m.getRepository(Repayment).findOne({ where: { id: repaymentId }, lock: { mode: 'pessimistic_write' } });
      if (!p || p.status !== RepaymentStatus.CREATED) return null;
      if (st.state === 'PENDING') {
        if (p.expiresAt < new Date(Date.now() - 15 * 60_000)) {
          p.status = RepaymentStatus.EXPIRED;
          await m.getRepository(Repayment).save(p);
        }
        return null;
      }
      if (st.state !== 'PAID') {
        p.status = st.state === 'FAILED' ? RepaymentStatus.FAILED : RepaymentStatus.EXPIRED;
        p.method = st.method;
        await m.getRepository(Repayment).save(p);
        return null;
      }
      const loan = await m.getRepository(Loan).findOne({ where: { id: p.loanId }, lock: { mode: 'pessimistic_write' } });
      if (!loan) return null;
      Object.assign(p, {
        status: RepaymentStatus.PAID, paidPaise: st.paidPaise, method: st.method, utr: st.utr, paidAt: st.paidAt ? new Date(st.paidAt) : new Date(),
        receiptNo: `RCPT-${istDate().replace(/-/g, '')}-${p.id.slice(-6).toUpperCase()}`,
      });
      await m.getRepository(Repayment).save(p);
      loan.paidPaise += st.paidPaise;
      const d = this.duesOf(loan)!;
      if (d.outstandingPaise === 0) Object.assign(loan, { status: LoanStatus.CLOSED, closedAt: new Date() });
      await m.getRepository(Loan).save(loan);
      await this.audit.record({ actorType: 'PROVIDER', action: 'repayment.received', entityType: 'loan', entityId: loan.id, data: { repaymentId: p.id, paid: st.paidPaise, utr: st.utr, outstanding: d.outstandingPaise, closed: loan.status === LoanStatus.CLOSED } }, m);
      return { loan, p, outstanding: d.outstandingPaise };
    });
    if (result) {
      const c = await this.ds.getRepository(Customer).findOneByOrFail({ id: result.loan.customerId });
      await this.notifier.once({
        loanId: result.loan.id, customerId: c.id, mobile: c.mobile, kind: `RECEIPT:${result.p.receiptNo}`, templateKey: result.loan.status === LoanStatus.CLOSED ? 'LOAN_CLOSED' : 'PAYMENT_RECEIVED',
        vars: { amount: formatInr(result.p.paidPaise), receipt: result.p.receiptNo!, outstanding: formatInr(result.outstanding) },
      });
    }
    return result;
  }

  async pollOpenPayments() {
    const items = await this.ds.getRepository(Repayment).find({ where: { status: RepaymentStatus.CREATED, createdAt: MoreThan(new Date(Date.now() - 86_400_000)) }, take: 200 });
    for (const p of items) {
      if (!p.orderId) continue;
      try { await this.apply(p.id, await this.gateway.status(p.orderId)); } catch (e) { this.log.warn(`Payment poll ${p.id}: ${(e as Error).message}`); }
    }
    return items.length;
  }

  async onWebhook(orderId: string) {
    const p = await this.ds.getRepository(Repayment).findOneBy({ orderId });
    if (!p) return { matched: false };
    await this.apply(p.id, await this.gateway.status(orderId));
    return { matched: true };
  }

  // ---------- daily: overdue + penal accrual ----------

  /** Accrues penal day by day up to `today` (idempotent via penalAccruedThrough). */
  async accrueOverdue(today = istDate()) {
    const loans = await this.ds.getRepository(Loan).find({ where: { status: In(OPEN), dueDate: LessThan(today) } });
    let updated = 0;
    for (const id of loans.map((l) => l.id)) {
      await this.ds.transaction(async (m: EntityManager) => {
        const l = await m.getRepository(Loan).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!l || !OPEN.includes(l.status)) return;
        let day = addDays(l.penalAccruedThrough && l.penalAccruedThrough > l.dueDate! ? l.penalAccruedThrough : l.dueDate!, 1);
        let added = 0;
        while (day <= today) {
          const p = penalForOneDay(l);
          l.penalAccruedPaise += p;
          added += p;
          l.penalAccruedThrough = day;
          day = addDays(day, 1);
        }
        l.status = LoanStatus.OVERDUE;
        await m.getRepository(Loan).save(l);
        if (added) await this.audit.record({ actorType: 'SYSTEM', action: 'loan.penal_accrued', entityType: 'loan', entityId: l.id, data: { added, through: l.penalAccruedThrough } }, m);
        updated++;
      });
    }
    return updated;
  }

  // ---------- reminders (no auto-debit, so these carry the collection) ----------

  async sendReminders(now = new Date()) {
    if (!inContactWindow(now)) return 0;
    const today = istDate(now);
    const loans = await this.ds.getRepository(Loan).find({ where: { status: In(OPEN) } });
    let sent = 0;
    for (const l of loans) {
      const r = REMINDERS.find((x) => addDays(l.dueDate!, x.offset) === today);
      if (!r) continue;
      const c = await this.ds.getRepository(Customer).findOneByOrFail({ id: l.customerId });
      const d = this.duesOf(l, today)!;
      const ok = await this.notifier.once({
        loanId: l.id, customerId: c.id, mobile: c.mobile, kind: r.kind, templateKey: r.template,
        vars: { name: (c.fullName ?? '').split(' ')[0], amount: formatInr(d.outstandingPaise), dueDate: l.dueDate!, link: `${this.cfg.publicWebUrl}/#loan/${l.id}` },
      });
      if (ok) sent++;
    }
    return sent;
  }

  // ---------- staff ----------

  async overdueList() {
    const loans = await this.ds.getRepository(Loan).find({ where: { status: LoanStatus.OVERDUE }, order: { dueDate: 'ASC' }, take: 500 });
    const customers = await this.ds.getRepository(Customer).findBy({ id: In(loans.map((l) => l.customerId)) });
    const byId = new Map(customers.map((c) => [c.id, c]));
    return loans.map((l) => {
      const c = byId.get(l.customerId);
      return { loanId: l.id, name: c?.fullName, mobile: c?.mobile, dueDate: l.dueDate, ...this.duesOf(l) };
    });
  }
}
