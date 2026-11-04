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

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { totp } from '../src/common/crypto';
import { Role } from '../src/common/roles';
import { DisbursementService } from '../src/disbursement/disbursement.service';
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

/** Runs the customer journey up to (and including) the risk assessment. */
async function toAssessment(opts: { pan: string; account: string; amount?: number; income?: number; mobile?: string }) {
  const token = await login(opts.mobile ?? String(mobileSeq++));
  const auth = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': `10.0.${Math.floor(mobileSeq / 250) % 250}.${mobileSeq % 250}` };
  const a = await http.post('/api/applications').set(auth).send({ deviceId: `dev-${mobileSeq}` }).expect(201);
  const id = a.body.id;
  const kyc = await http.post(`/api/applications/${id}/kyc`).set(auth).send({ pan: opts.pan, fullName: 'Rahul Kumar Sharma', dateOfBirth: '1992-04-10', consentKyc: true }).expect(200);
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
  const done = await http.post(`/api/applications/${id}/esign/complete`).set(auth).send({ otp: e.body.sandboxOtp }).expect(200);
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
    await http.post(`/api/applications/${body.id}/kyc`).set(auth).send({ pan: 'ABCDE4567F', fullName: 'Rahul Kumar Sharma', dateOfBirth: '1992-04-10', consentKyc: true }).expect(200);
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

  it('reports the SLA: share within 5 minutes and per-step timings', async () => {
    const m = await http.get('/api/admin/metrics/instant-disbursal').set('Authorization', `Bearer ${staff.compliance.token}`).expect(200);
    expect(m.body.disbursed).toBeGreaterThanOrEqual(3);
    expect(m.body.withinTargetPct).toBe(100);
    expect(m.body.steps.map((s: { step: string }) => s.step)).toEqual(expect.arrayContaining(['KYC', 'BANK_VERIFICATION', 'CREDIT_RISK', 'DISBURSAL']));
  });
});
