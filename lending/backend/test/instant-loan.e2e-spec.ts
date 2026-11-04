import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://lending:lending@localhost:5432/lending_test';
process.env.INTEGRATIONS_MODE = 'sandbox';
process.env.SANDBOX_LATENCY_MS = '20';
process.env.DISABLE_JOBS = 'true';
process.env.PAYOUT_WEBHOOK_SECRET = 'test-webhook';
process.env.PAYMENT_WEBHOOK_SECRET = 'test-payment';
process.env.DIGIO_WEBHOOK_SECRET = 'test-digio';
process.env.EKYC_PROVIDER = 'sandbox';
process.env.ESIGN_PROVIDER = 'sandbox';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { totp } from '../src/common/crypto';
import { Role } from '../src/common/roles';
import { DisbursementService } from '../src/disbursement/disbursement.service';
import { SANDBOX } from '../src/integrations/integrations.module';
import { SandboxEkyc, SandboxSms } from '../src/integrations/sandbox/sandbox.adapters';
import { addDays, istDate } from '../src/repayment/loan.math';
import { RepaymentService } from '../src/repayment/repayment.service';
import { StaffService } from '../src/staff/staff.service';

let app: INestApplication;
let ds: DataSource;
let http: ReturnType<typeof request>;
let mobileSeq = 9000000000;

const staff: Record<string, { token: string; id: string; secret: string }> = {};
const owner = () => ({ Authorization: `Bearer ${staff.founder.token}`, 'x-totp': totp(staff.founder.secret) });
const DEFAULT_PLAN = {
  name: 'Default', scope: 'ALL', interestUnit: 'PER_ANNUM', interestRatePercent: 18, feeType: 'PERCENT', feeValue: 1, gstPercent: 18,
  tenureDays: 30, minAmount: 10000, maxAmount: 30000, penalType: 'PERCENT_PER_DAY', penalValue: 0.1, coolingOffDays: 3, aprCapPercent: 36,
};
let defaultPlanId: string;

async function login(mobile: string) {
  const r = await http.post('/api/auth/otp/request').send({ mobile }).expect(200);
  const v = await http.post('/api/auth/otp/verify').send({ mobile, challengeId: r.body.challengeId, otp: r.body.sandboxOtp }).expect(200);
  return v.body.accessToken as string;
}

/** DigiLocker eKYC: start → (sandbox) customer completes Digio flow → result. */
async function doKyc(id: string, auth: Record<string, string>, pan: string, fullName = 'Rahul Kumar Sharma') {
  const st = await http.post(`/api/applications/${id}/kyc/start`).set(auth).send({ consentKyc: true }).expect(200);
  expect(st.body.kyc).toMatchObject({ provider: 'sandbox', identifier: expect.any(String) });
  await http.post(`/api/sandbox/ekyc/${st.body.kyc.requestId}/complete`).send({ pan, fullName, dateOfBirth: '1992-04-10' }).expect(200);
  return http.post(`/api/applications/${id}/kyc/complete`).set(auth).expect(200);
}

/** Runs the customer journey up to (and including) the risk assessment. */
async function toAssessment(opts: { pan: string; account: string; amount?: number; income?: number; mobile?: string }) {
  const token = await login(opts.mobile ?? String(mobileSeq++));
  const auth = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': `10.0.${Math.floor(mobileSeq / 250) % 250}.${mobileSeq % 250}` };
  const a = await http.post('/api/applications').set(auth).send({ deviceId: `dev-${mobileSeq}` }).expect(201);
  const id = a.body.id;
  const kyc = await doKyc(id, auth, opts.pan);
  if (kyc.body.status !== 'KYC_VERIFIED') return { id, auth, res: kyc };
  await http.post(`/api/applications/${id}/bank-account`).set(auth).send({ accountNumber: opts.account, ifsc: 'HDFC0001234' }).expect(200);
  const res = await http
    .post(`/api/applications/${id}/assessment`)
    .set(auth)
    .send({ requestedAmount: opts.amount ?? 20000, monthlyIncome: opts.income ?? 60000, existingMonthlyEmi: 0, employmentType: 'SALARIED', consentBureau: true })
    .expect(200);
  return { id, auth, res };
}

async function signAndDisburse(id: string, auth: Record<string, string>) {
  const k = await http.get(`/api/applications/${id}/kfs`).set(auth).expect(200);
  await http.post(`/api/applications/${id}/kfs/accept`).set(auth).send({ kfsHash: k.body.kfsHash, consentKfs: true }).expect(200);
  const e = await http.post(`/api/applications/${id}/esign/initiate`).set(auth).expect(200);
  // The customer signs with Aadhaar OTP in Digio's flow (sandbox stand-in), then the SDK returns.
  await http.post(`/api/sandbox/esign/${e.body.esign.requestId}/sign`).send({ otp: '123456' }).expect(200);
  const done = await http.post(`/api/applications/${id}/esign/complete`).set(auth).expect(200);
  return { kfs: k.body.kfs, afterSign: done.body };
}

async function settle(id: string, auth: Record<string, string>) {
  const svc = app.get(DisbursementService);
  for (let i = 0; i < 40; i++) {
    await svc.pollPending();
    const s = await http.get(`/api/applications/${id}`).set(auth).expect(200);
    if (['DISBURSED', 'DISBURSAL_FAILED'].includes(s.body.status)) return s.body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('payout did not settle');
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication({ rawBody: true });
  configureApp(app, 'http://localhost');
  ds = app.get(getDataSourceToken());
  await ds.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await ds.runMigrations();
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;

  const svc = app.get(StaffService);
  const mk = async (key: string, roles: Role[]) => {
    const r = await svc.create({ email: `${key}@t.in`, name: key, title: key, password: 'Password-123456', roles }, null);
    const l = await http.post('/api/staff/login').send({ email: `${key}@t.in`, password: 'Password-123456', totp: totp(r.totpSecret) }).expect(200);
    staff[key] = { token: l.body.accessToken, id: r.id, secret: r.totpSecret };
  };
  await mk('founder', [Role.OWNER, Role.SUPER_ADMIN, Role.CREDIT_RISK_MANAGER]);
  await mk('compliance', [Role.COMPLIANCE_OFFICER, Role.GRIEVANCE_OFFICER]);
  await mk('creditops', [Role.CREDIT_ANALYST, Role.OPERATIONS_MANAGER, Role.KYC_VERIFIER]);
  await mk('finance', [Role.FINANCE_MANAGER]);
  await mk('support', [Role.CUSTOMER_SUPPORT, Role.COLLECTION_AGENT]);

  // Only the owner can set prices, and only with a fresh authenticator code.
  await http.post('/api/admin/pricing-plans').set('Authorization', `Bearer ${staff.compliance.token}`).send(DEFAULT_PLAN).expect(403);
  await http.post('/api/admin/pricing-plans').set('Authorization', `Bearer ${staff.founder.token}`).send(DEFAULT_PLAN).expect(401);
  const d = await http.post('/api/admin/pricing-plans').set(owner()).send(DEFAULT_PLAN).expect(201);
  defaultPlanId = d.body.id;
});

afterAll(async () => {
  await app?.close();
});

describe('5-minute instant disbursement journey', () => {
  it('takes a clean applicant from OTP login to money in the bank, within target', async () => {
    const { id, auth, res } = await toAssessment({ pan: 'ABCDE1234F', account: '50100012345678' });
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.offer.principalPaise).toBe(2_000_000);

    const { kfs, afterSign } = await signAndDisburse(id, auth);
    expect(kfs.aprPercent).toBe((res.body.offer.aprBps / 100).toFixed(2));
    expect(kfs.disbursalAccount.last4).toBe('5678');
    expect(afterSign.status).toBe('DISBURSING');

    const s = await settle(id, auth);
    expect(s.status).toBe('DISBURSED');
    expect(s.withinTarget).toBe(true);
    expect(s.elapsedMs).toBeLessThan(300_000);
    expect(s.payouts).toHaveLength(1);
    expect(s.payouts[0]).toMatchObject({ rail: 'IMPS', status: 'SUCCESS' });
    expect(s.payouts[0].utr).toMatch(/^\d{12}$/);
    expect(s.loan.status).toBe('ACTIVE');
    expect(s.loan.netDisbursalPaise).toBe(1_976_400);
    expect(s.steps.every((st: { outcome: string }) => st.outcome === 'PASSED')).toBe(true);

    // Finance reconciles the payout against the settlement feed.
    const rec = await http.post('/api/admin/reconciliation/run').set('Authorization', `Bearer ${staff.finance.token}`).expect(200);
    expect(rec.body.matched).toBeGreaterThanOrEqual(1);
    expect(rec.body.mismatched).toBe(0);
  });

  it('falls back from IMPS to NEFT only after IMPS is confirmed failed', async () => {
    const { id, auth } = await toAssessment({ pan: 'ABCDE2345F', account: '50100012342222' });
    await signAndDisburse(id, auth);
    const s = await settle(id, auth);
    expect(s.status).toBe('DISBURSED');
    expect(s.payouts.map((p: { rail: string; status: string }) => `${p.rail}:${p.status}`)).toEqual(['IMPS:FAILED', 'NEFT:SUCCESS']);
  });

  it('cancels the loan with no charges when the account is closed', async () => {
    const { id, auth } = await toAssessment({ pan: 'ABCDE3456F', account: '50100012343333' });
    await signAndDisburse(id, auth);
    const s = await settle(id, auth);
    expect(s.status).toBe('DISBURSAL_FAILED');
    expect(s.loan.status).toBe('CANCELLED');
    expect(s.payouts).toHaveLength(1);
  });

  it('rejects accounts that are not in the borrower’s name', async () => {
    const token = await login(String(mobileSeq++));
    const auth = { Authorization: `Bearer ${token}` };
    const { body } = await http.post('/api/applications').set(auth).send({}).expect(201);
    await doKyc(body.id, auth, 'ABCDE4567F');
    await http.post(`/api/applications/${body.id}/bank-account`).set(auth).send({ accountNumber: '50100012341111', ifsc: 'HDFC0001234' }).expect(422);
  });

  it('rejects poor credit and refers borderline cases to the credit analyst', async () => {
    const rej = await toAssessment({ pan: 'ABCDE7123F', account: '50100099990001' });
    expect(rej.res.body.status).toBe('REJECTED');
    expect(rej.res.body.reasons).toContain('BUREAU_SCORE_LOW');

    const ref = await toAssessment({ pan: 'ABCDE6123F', account: '50100099990002' });
    expect(ref.res.body.status).toBe('MANUAL_REVIEW');
    const analyst = { Authorization: `Bearer ${staff.creditops.token}` };
    await http.post(`/api/admin/applications/${ref.id}/review`).set({ Authorization: `Bearer ${staff.support.token}` }).send({ decision: 'APPROVE', note: 'looks ok' }).expect(403);
    const q = await http.get('/api/admin/applications/review-queue').set(analyst).expect(200);
    expect(q.body.map((a: { id: string }) => a.id)).toContain(ref.id);
    const r = await http.post(`/api/admin/applications/${ref.id}/review`).set(analyst).send({ decision: 'APPROVE', approvedAmount: 15000, note: 'Salary slips verified' }).expect(200);
    expect(r.body.offer.principalPaise).toBe(1_500_000);
    await signAndDisburse(ref.id, ref.auth);
    expect((await settle(ref.id, ref.auth)).status).toBe('DISBURSED');
  });

  it('refuses a stale KFS hash and steps out of order', async () => {
    const { id, auth } = await toAssessment({ pan: 'ABCDE5123F', account: '50100099990003' });
    await http.post(`/api/applications/${id}/esign/initiate`).set(auth).expect(409);
    await http.post(`/api/applications/${id}/kfs/accept`).set(auth).send({ kfsHash: 'a'.repeat(64), consentKfs: true }).expect(409);
  });

  it('only accepts signed payout webhooks', async () => {
    const body = JSON.stringify({ providerRef: 'pout_unknown' });
    await http.post('/api/webhooks/payout').set('content-type', 'application/json').set('x-signature', '00').send(body).expect(401);
    const sig = createHmac('sha256', 'test-webhook').update(body).digest('hex');
    const ok = await http.post('/api/webhooks/payout').set('content-type', 'application/json').set('x-signature', sig).send(body).expect(200);
    expect(ok.body.matched).toBe(false);
  });

  it('blocks conflicting roles for one person and keeps the audit log append-only', async () => {
    const r = await http
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${staff.founder.token}`)
      .send({ email: 'x@t.in', name: 'Xy', title: 'Xy', password: 'Password-123456', roles: ['OWNER', 'AUDITOR'] })
      .expect(400);
    expect(r.body.message).toMatch(/maker-checker/);
    await expect(ds.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });

  it('gives a specific customer their personal offer (per-day interest, flat fee, one use)', async () => {
    const mobile = '8800000001';
    const plan = await http.post('/api/admin/pricing-plans').set(owner()).send({
      ...DEFAULT_PLAN, name: 'VIP', scope: 'CUSTOMER', customerMobile: mobile, customerLabel: 'Special rate for you',
      interestUnit: 'PER_DAY', interestRatePercent: 0.04, feeType: 'FLAT', feeValue: 99, maxUses: 1,
    }).expect(201);
    const pre = await http.get(`/api/admin/pricing-plans/preview?mobile=${mobile}&amount=20000`).set('Authorization', `Bearer ${staff.compliance.token}`).expect(200);
    expect(pre.body.plan.id).toBe(plan.body.id);

    const { id, auth, res } = await toAssessment({ pan: 'ABCDE1357F', account: '50100055550001', mobile });
    expect(res.body.offer.planId).toBe(plan.body.id);
    expect(res.body.offer.processingFeePaise).toBe(9_900);
    expect(res.body.offer.interestPaise).toBe(24_000); // 0.04% × 30 days × ₹20,000
    const { kfs } = await signAndDisburse(id, auth);
    expect(kfs.offerName).toBe('Special rate for you');
    expect(kfs.interest.rate).toMatch(/^0.04% per day/);
    expect((await settle(id, auth)).status).toBe('DISBURSED');

    // Used once → the customer falls back to the plan for everyone.
    const after = await http.get(`/api/admin/pricing-plans/preview?mobile=${mobile}&amount=20000`).set(owner()).expect(200);
    expect(after.body.plan.id).toBe(defaultPlanId);
  });

  it('runs a time-limited offer for all customers and switches it off', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const promo = await http.post('/api/admin/pricing-plans').set(owner()).send({
      ...DEFAULT_PLAN, name: 'Festival', customerLabel: 'Festival offer: zero fee', feeValue: 0, priority: 10, validUntil: until,
    }).expect(201);
    const { res } = await toAssessment({ pan: 'ABCDE1468F', account: '50100055550002' });
    expect(res.body.offer.planId).toBe(promo.body.id);
    expect(res.body.offer.processingFeePaise).toBe(0);

    await http.patch(`/api/admin/pricing-plans/${promo.body.id}`).set(owner()).send({ active: false }).expect(200);
    const pre = await http.get('/api/admin/pricing-plans/preview?mobile=9999999999&amount=20000').set(owner()).expect(200);
    expect(pre.body.plan.id).toBe(defaultPlanId);
  });

  it('applies owner changes to new offers only; an offer already shown keeps its KFS', async () => {
    const { id, auth, res } = await toAssessment({ pan: 'ABCDE1579F', account: '50100055550003' });
    const before = await http.get(`/api/applications/${id}/kfs`).set(auth).expect(200);
    await http.patch(`/api/admin/pricing-plans/${defaultPlanId}`).set(owner()).send({ interestRatePercent: 20 }).expect(200);
    const again = await http.get(`/api/applications/${id}/kfs`).set(auth).expect(200);
    expect(again.body.kfsHash).toBe(before.body.kfsHash);
    await signAndDisburse(id, auth);
    const s = await settle(id, auth);
    expect(s.loan.totalRepayablePaise).toBe(res.body.offer.totalRepayablePaise);

    const fresh = await http.get('/api/admin/pricing-plans/preview?mobile=9999999999&amount=20000').set(owner()).expect(200);
    expect(fresh.body.offer.annualInterestPercent).toBe(20);
    const audit = await http.get(`/api/admin/audit?entityType=pricing_plan&entityId=${defaultPlanId}`).set(owner()).expect(200);
    expect(audit.body[0].data).toMatchObject({ before: { interestRatePercent: 18 }, after: { interestRatePercent: 20 } });
    await http.patch(`/api/admin/pricing-plans/${defaultPlanId}`).set(owner()).send({ interestRatePercent: 18 }).expect(200);
  });

  it('validates plans: APR cap, customer mobile, fees larger than the loan', async () => {
    const r = await http.post('/api/admin/pricing-plans').set(owner()).send({ ...DEFAULT_PLAN, interestUnit: 'PER_DAY', interestRatePercent: 1 }).expect(400);
    expect(r.body.message).toMatch(/APR cap/);
    await http.post('/api/admin/pricing-plans').set(owner()).send({ ...DEFAULT_PLAN, scope: 'CUSTOMER' }).expect(400);
    await http.post('/api/admin/pricing-plans').set(owner()).send({ ...DEFAULT_PLAN, feeType: 'FLAT', feeValue: 15000, aprCapPercent: null }).expect(400);
    // Without a cap the owner may set any rate, e.g. 1% per day.
    const ok = await http.post('/api/admin/pricing-plans').set(owner()).send({ ...DEFAULT_PLAN, name: 'Uncapped', active: false, interestUnit: 'PER_DAY', interestRatePercent: 1, aprCapPercent: null }).expect(201);
    expect(ok.body.interestRatePercent).toBe(1);
  });

  it('lets only an owner create another owner', async () => {
    const svc = app.get(StaffService);
    const r = await svc.create({ email: 'admin2@t.in', name: 'Admin', title: 'Admin', password: 'Password-123456', roles: [Role.SUPER_ADMIN] }, null);
    const l = await http.post('/api/staff/login').send({ email: 'admin2@t.in', password: 'Password-123456', totp: totp(r.totpSecret) }).expect(200);
    await http.post('/api/admin/staff').set('Authorization', `Bearer ${l.body.accessToken}`)
      .send({ email: 'o2@t.in', name: 'Owner Two', title: 'Owner', password: 'Password-123456', roles: ['OWNER'] }).expect(403);
  });

  it('does eKYC through DigiLocker (Digio) and handles rejection, expiry-style retry and signed webhooks', async () => {
    const token = await login(String(mobileSeq++));
    const auth = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '10.9.9.1' };
    const { body } = await http.post('/api/applications').set(auth).send({}).expect(201);
    // Not finished in the SDK yet → still pending.
    const st = await http.post(`/api/applications/${body.id}/kyc/start`).set(auth).send({ consentKyc: true }).expect(200);
    expect((await http.post(`/api/applications/${body.id}/kyc/complete`).set(auth).expect(200)).body).toMatchObject({ status: 'STARTED', kyc: 'PENDING' });
    // A refresh re-uses the same request.
    expect((await http.post(`/api/applications/${body.id}/kyc/start`).set(auth).send({ consentKyc: true }).expect(200)).body.kyc.requestId).toBe(st.body.kyc.requestId);

    // Digio webhook: bad checksum refused; good one makes the server re-read the result from Digio.
    app.get<SandboxEkyc>(SANDBOX.EKYC).simulate(st.body.kyc.requestId, { pan: 'ABCDE2468F', fullName: 'Rahul Kumar Sharma', dateOfBirth: '1992-04-10' });
    const hook = JSON.stringify({ id: 'evt_1', event: 'KYC.REQUEST.APPROVED', payload: { KYC_REQUEST: { id: st.body.kyc.requestId } } });
    await http.post('/api/webhooks/digio').set('content-type', 'application/json').set('x-digio-checksum', 'ab').send(hook).expect(401);
    const sig = createHmac('sha256', 'test-digio').update(hook).digest('hex');
    const r = await http.post('/api/webhooks/digio').set('content-type', 'application/json').set('x-digio-checksum', sig).send(hook).expect(200);
    expect(r.body).toMatchObject({ matched: true, status: 'KYC_VERIFIED' });

    const bad = await toAssessment({ pan: 'ABCDE2469Z', account: '50100066660001' });
    const after = await http.get(`/api/applications/${bad.id}`).set(bad.auth).expect(200);
    expect(after.body).toMatchObject({ status: 'REJECTED', reasons: ['KYC_REJECTED'] });
  });

  it('e-signs a generated agreement PDF and keeps it as evidence', async () => {
    const { id, auth } = await toAssessment({ pan: 'ABCDE2470F', account: '50100066660002' });
    await signAndDisburse(id, auth);
    const pdf = await http.get(`/api/applications/${id}/agreement.pdf`).set(auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const [row] = await ds.query(`SELECT "agreementSha256" FROM loan_applications WHERE id = $1`, [id]);
    expect(require('crypto').createHash('sha256').update(pdf.body).digest('hex')).toBe(row.agreementSha256);
    expect((await settle(id, auth)).status).toBe('DISBURSED');
  });

  it('lets the borrower repay by UPI (no eNACH): part payment, then full payoff with pro-rata interest', async () => {
    const mobile = '8700000001';
    const { id, auth } = await toAssessment({ pan: 'ABCDE2471F', account: '50100066660003', mobile });
    await signAndDisburse(id, auth);
    const s = await settle(id, auth);
    const loanId = s.loan.id;
    const sms = app.get<SandboxSms>(SANDBOX.SMS);
    expect(sms.sent.some((m) => m.mobile === mobile && m.templateKey === 'LOAN_DISBURSED')).toBe(true);

    const l = await http.get(`/api/loans/${loanId}`).set(auth).expect(200);
    expect(l.body.dues.daysUsed).toBe(1);
    expect(l.body.dues.outstandingPaise).toBe(2_000_000 + Math.round(29_589 / 30)); // 1 day interest
    expect(l.body.howToPay).toMatch(/No auto-debit/);

    await http.post(`/api/loans/${loanId}/payments`).set(auth).send({ amount: 999999 }).expect(400);
    const part = await http.post(`/api/loans/${loanId}/payments`).set(auth).send({ amount: 5000 }).expect(201);
    expect(part.body.upiIntentUrl).toMatch(/^upi:\/\/pay/);
    const orderId = part.body.paymentUrl.split('/').pop();
    await http.post(`/api/sandbox/payments/${orderId}/pay`).send({ outcome: 'PAID', method: 'UPI' }).expect(200);
    // Paying twice for one order (e.g. webhook + poller) is counted once.
    await app.get(RepaymentService).pollOpenPayments();
    const afterPart = await http.get(`/api/loans/${loanId}`).set(auth).expect(200);
    expect(afterPart.body.status).toBe('ACTIVE');
    expect(afterPart.body.dues.paidPaise).toBe(500_000);

    const full = await http.post(`/api/loans/${loanId}/payments`).set(auth).send({}).expect(201);
    expect(full.body.amountPaise).toBe(afterPart.body.dues.outstandingPaise);
    // Payment gateway webhook (signed) confirms the second payment.
    app.get(SANDBOX.PAYMENTS as any).simulate(full.body.paymentUrl.split('/').pop(), 'PAID', 'NETBANKING');
    const body = JSON.stringify({ orderId: full.body.paymentUrl.split('/').pop() });
    await http.post('/api/webhooks/payment').set('content-type', 'application/json').set('x-signature', '00').send(body).expect(401);
    await http.post('/api/webhooks/payment').set('content-type', 'application/json').set('x-signature', createHmac('sha256', 'test-payment').update(body).digest('hex')).send(body).expect(200);
    const closed = await http.get(`/api/loans/${loanId}`).set(auth).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.payments.filter((p: { status: string }) => p.status === 'PAID')).toHaveLength(2);
    expect(sms.sent.some((m) => m.mobile === mobile && m.templateKey === 'LOAN_CLOSED')).toBe(true);
  });

  it('marks loans overdue, accrues penal once per day, reminds within contact hours and lists them for collections', async () => {
    const mobile = '8700000002';
    const { id, auth } = await toAssessment({ pan: 'ABCDE2472F', account: '50100066660004', mobile });
    await signAndDisburse(id, auth);
    const loanId = (await settle(id, auth)).loan.id;
    const today = istDate();
    // Pretend the loan was disbursed 33 days ago → due 3 days ago.
    await ds.query(`UPDATE loans SET "disbursedAt" = now() - interval '33 days', "dueDate" = $2, "coolingOffEndsOn" = $3 WHERE id = $1`, [loanId, addDays(today, -3), addDays(today, -30)]);
    const svc = app.get(RepaymentService);
    await svc.accrueOverdue(today);
    await svc.accrueOverdue(today); // idempotent
    const l = await http.get(`/api/loans/${loanId}`).set(auth).expect(200);
    expect(l.body.status).toBe('OVERDUE');
    expect(l.body.dues.overdueDays).toBe(3);
    expect(l.body.dues.penalPaise).toBe(3 * Math.round(2_029_589 * 0.001));
    expect(l.body.dues.outstandingPaise).toBe(2_029_589 + 3 * Math.round(2_029_589 * 0.001));

    const tenAmIst = new Date(`${today}T04:30:00Z`);
    expect(await svc.sendReminders(new Date(`${today}T15:30:00Z`))).toBe(0); // 9 PM IST: outside contact hours
    expect(await svc.sendReminders(tenAmIst)).toBeGreaterThanOrEqual(1);
    expect(await svc.sendReminders(tenAmIst)).toBe(0); // never twice
    expect(app.get<SandboxSms>(SANDBOX.SMS).sent.filter((m) => m.mobile === mobile && m.templateKey === 'REPAYMENT_OVERDUE')).toHaveLength(1);

    const list = await http.get('/api/admin/collections/overdue').set('Authorization', `Bearer ${staff.support.token}`).expect(200);
    expect(list.body.map((x: { loanId: string }) => x.loanId)).toContain(loanId);
    await http.get('/api/admin/collections/overdue').set('Authorization', `Bearer ${staff.compliance.token}`).expect(403);
  });

  it('reports the SLA: share within 5 minutes and per-step timings', async () => {
    const m = await http.get('/api/admin/metrics/instant-disbursal').set('Authorization', `Bearer ${staff.compliance.token}`).expect(200);
    expect(m.body.disbursed).toBeGreaterThanOrEqual(3);
    expect(m.body.withinTargetPct).toBe(100);
    expect(m.body.steps.map((s: { step: string }) => s.step)).toEqual(expect.arrayContaining(['KYC', 'BANK_VERIFICATION', 'CREDIT_RISK', 'DISBURSAL']));
  });
});
