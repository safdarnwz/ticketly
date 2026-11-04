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

const staff: Record<string, { token: string; id: string }> = {};

async function login(mobile: string) {
  const r = await http.post('/api/auth/otp/request').send({ mobile }).expect(200);
  const v = await http.post('/api/auth/otp/verify').send({ mobile, challengeId: r.body.challengeId, otp: r.body.sandboxOtp }).expect(200);
  return v.body.accessToken as string;
}

/** Runs the customer journey up to (and including) the risk assessment. */
async function toAssessment(opts: { pan: string; account: string; amount?: number; income?: number }) {
  const token = await login(String(mobileSeq++));
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
    staff[key] = { token: l.body.accessToken, id: r.id };
  };
  await mk('founder', [Role.SUPER_ADMIN, Role.CREDIT_RISK_MANAGER]);
  await mk('compliance', [Role.COMPLIANCE_OFFICER, Role.GRIEVANCE_OFFICER]);
  await mk('creditops', [Role.CREDIT_ANALYST, Role.OPERATIONS_MANAGER, Role.KYC_VERIFIER]);
  await mk('finance', [Role.FINANCE_MANAGER]);
  await mk('support', [Role.CUSTOMER_SUPPORT, Role.COLLECTION_AGENT]);

  const policy = {
    name: '18% / 1% / 30d', annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 1800, tenureDays: 30,
    minPrincipalPaise: 1_000_000, maxPrincipalPaise: 3_000_000, aprCapBps: 3600, coolingOffDays: 3, penalChargesText: '2% per month on overdue amount only',
  };
  const d = await http.post('/api/admin/pricing-policies').set('Authorization', `Bearer ${staff.founder.token}`).send(policy).expect(201);
  // Maker cannot also be checker (the founder lacks the permission anyway); compliance activates.
  await http.post(`/api/admin/pricing-policies/${d.body.id}/activate`).set('Authorization', `Bearer ${staff.founder.token}`).send({ boardApprovalRef: 'BR-1' }).expect(403);
  await http.post(`/api/admin/pricing-policies/${d.body.id}/activate`).set('Authorization', `Bearer ${staff.compliance.token}`).send({ boardApprovalRef: 'BR-2026-11-01' }).expect(200);
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
      .send({ email: 'x@t.in', name: 'Xy', title: 'Xy', password: 'Password-123456', roles: ['CREDIT_RISK_MANAGER', 'COMPLIANCE_OFFICER'] })
      .expect(400);
    expect(r.body.message).toMatch(/maker-checker/);
    await expect(ds.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
  });

  it('reports the SLA: share within 5 minutes and per-step timings', async () => {
    const m = await http.get('/api/admin/metrics/instant-disbursal').set('Authorization', `Bearer ${staff.compliance.token}`).expect(200);
    expect(m.body.disbursed).toBeGreaterThanOrEqual(3);
    expect(m.body.withinTargetPct).toBe(100);
    expect(m.body.steps.map((s: { step: string }) => s.step)).toEqual(expect.arrayContaining(['KYC', 'BANK_VERIFICATION', 'CREDIT_RISK', 'DISBURSAL']));
  });
});
