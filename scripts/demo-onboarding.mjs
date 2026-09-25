#!/usr/bin/env node
/**
 * Operator onboarding, live, step by step:  npm run demo:onboarding
 *
 * Runs against a RUNNING API (npm run dev) and walks 10 operators through
 * every path an application can take — approved, rejected, on hold,
 * reopened, blocked by bad KYC, duplicates, suspended after going live.
 * Every request and the API's answer are printed; a Markdown copy is
 * written to onboarding-demo.md.
 *
 *   BASE_URL   default http://localhost:<HTTP_PORT from .env, else 3000>
 *   Super admin credentials come from .env (SUPER_ADMIN_EMAIL / _PASSWORD).
 *
 * Each run uses fresh emails, mobiles, PANs and GSTINs, so it can be re-run.
 * Not for production: it signs in with the dev-only X-Debug-Surface header.
 */
import { existsSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.HTTP_PORT ?? 3000}`;
const API = `${BASE}/api/v1`;
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

const md = [];
const out = (line = '') => {
  process.stdout.write(`${line}\n`);
  md.push(line);
};

/* ─── unique, valid-looking Indian KYC numbers for this run ─────────────── */
const run = Date.now().toString(36).toUpperCase();
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let seq = 0;
function kyc() {
  seq += 1;
  const n = Date.now() + seq * 7919;
  const l = (i) => LETTERS[Math.floor(n / 26 ** i) % 26];
  // PAN: 3 letters, 'C' (company), 1 letter, 4 digits, 1 letter.
  const pan = `${l(0)}${l(1)}${l(2)}C${l(3)}${String(n % 10000).padStart(4, '0')}${l(4)}`;
  // GSTIN: state code + PAN + entity number + 'Z' + check character.
  return { pan, gst: `08${pan}1Z${seq % 10}` };
}
const mobile = () => `9${String(Date.now() + seq++ * 104729).slice(-9)}`;
const BANK = {
  bankAccountHolder: '',
  bankAccountNumber: '50100234567891',
  bankIfsc: 'HDFC0001234',
  bankName: 'HDFC Bank',
};

/* ─── HTTP with a readable trace ───────────────────────────────────────── */
let adminToken = '';

async function call(label, method, path, { body, token, headers = {}, expect } = {}) {
  const h = { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 60);
      out(
        `   ⏳ 429 Too Many Requests — the public form allows 5 applications a minute per IP. Waiting ${wait}s…`,
      );
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    const ok = expect ? expect === res.status : res.status < 300;
    out(`   ${ok ? '✔' : '✘'} ${method} ${path}  →  ${res.status}  ${label}`);
    const shown = summarise(json);
    if (shown) out(`      ${shown}`);
    if (!ok) out(`      (expected ${expect ?? '2xx'})`);
    return { status: res.status, body: json };
  }
}

function summarise(b) {
  if (!b || typeof b !== 'object') return String(b ?? '').slice(0, 200);
  if (b.detail || b.title) return `“${b.detail ?? b.title}”`;
  const keep = {};
  for (const k of ['applicationId', 'status', 'tenantId', 'slug', 'consoleUrl', 'ok'])
    if (k in b) keep[k] = b[k];
  if (b.accessToken) keep.accessToken = `${String(b.accessToken).slice(0, 16)}…`;
  return Object.keys(keep).length ? JSON.stringify(keep) : JSON.stringify(b).slice(0, 200);
}

function step(n, title, story) {
  out('');
  out(`## ${n}. ${title}`);
  out(`_${story}_`);
  out('');
}

/* ─── building blocks ──────────────────────────────────────────────────── */
function application(name, over = {}) {
  const k = kyc();
  const first = name.split(' ')[0];
  return {
    firstName: first,
    lastName: 'Owner',
    email: `${first.toLowerCase()}.${seq}.${run.toLowerCase()}@example.in`,
    mobile: mobile(),
    password: 'Operator@123',
    designation: 'Director',
    companyName: name,
    companyType: 'Private Limited',
    gstNumber: k.gst,
    panNumber: k.pan,
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    pinCode: '302001',
    business: {
      numberOfBuses: 12,
      busTypes: ['AC Sleeper', 'Seater'],
      cities: ['Jaipur', 'Delhi'],
    },
    ...BANK,
    bankAccountHolder: name,
    ...over,
  };
}

const apply = (label, app, expect) =>
  call(label, 'POST', '/operators/apply', { body: app, expect });
const review = (id, action, reason, expect) =>
  call(`${action}`, 'POST', `/admin/operator-applications/${id}/${action}`, {
    token: adminToken,
    body: action === 'approve' ? (reason ? { note: reason } : {}) : { reason },
    expect,
  });
const operatorLogin = (app, slug, expect) =>
  call('operator signs in to its own console', 'POST', '/auth/login', {
    body: { identifier: app.email, password: app.password },
    headers: { 'x-debug-surface': 'tenantAdmin', 'x-tenant-slug': slug },
    expect,
  });

/* ─── the walk-through ─────────────────────────────────────────────────── */
async function main() {
  out(`# Operator onboarding — live run ${new Date().toISOString()}`);
  out(`API: ${API}`);
  out('');
  out('Flow: operator fills the public form → application is **pending** → super admin reviews →');
  out('**approve** (operator account + console created) / **hold** (stays pending, reason sent) /');
  out(
    '**reject** (reason sent; can be **reopened**). Approval is blocked until KYC and bank details are valid.',
  );

  step(0, 'Super admin signs in', 'Only a platform admin can review applications.');
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD)
    throw new Error('Set SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in .env');
  const login = await call('super admin login', 'POST', '/auth/login', {
    body: { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { 'x-debug-surface': 'superAdmin' },
  });
  adminToken = login.body.accessToken;
  if (!adminToken) throw new Error('Super admin login failed — is the API running and seeded?');

  const results = [];

  // 1 — happy path
  step(
    1,
    'Sharma Travels — clean application, approved',
    'Everything valid → approve → the operator signs in to its own console.',
  );
  const a1 = application('Sharma Travels');
  const r1 = await apply('application submitted (public form, no login)', a1);
  const d1 = await call(
    'super admin opens the application',
    'GET',
    `/admin/operator-applications/${r1.body.applicationId}`,
    { token: adminToken },
  );
  out(`      status = ${d1.body.status}, company = ${d1.body.companyName}`);
  const ok1 = await review(r1.body.applicationId, 'approve', 'KYC and bank verified');
  await operatorLogin(a1, ok1.body.slug);
  await review(r1.body.applicationId, 'approve', undefined, 422);
  out('      ↳ approving twice is refused: an approved application is final.');
  results.push(['Sharma Travels', 'approved', 'live; console login works; second approve refused']);

  // 2 — hold, then approve
  step(
    2,
    'Rathore Bus Service — put on hold, then approved',
    'Admin needs one more document: hold keeps it pending with a reason, later approved.',
  );
  const a2 = application('Rathore Bus Service');
  const r2 = await apply('application submitted', a2);
  await review(r2.body.applicationId, 'hold', 'short', 400);
  out('      ↳ a hold / reject / reopen reason must be at least 10 characters.');
  await review(
    r2.body.applicationId,
    'hold',
    'Please upload the fleet list with RC numbers of all buses',
  );
  const d2 = await call(
    'status after hold',
    'GET',
    `/admin/operator-applications/${r2.body.applicationId}`,
    { token: adminToken },
  );
  out(`      status = ${d2.body.status} (hold keeps it pending)`);
  await review(r2.body.applicationId, 'approve', 'Fleet list received');
  results.push(['Rathore Bus Service', 'approved', 'held first (reason required), then approved']);

  // 3 — invalid GSTIN → cannot approve → rejected
  step(
    3,
    'Fake Travels — invalid GSTIN, rejected',
    'Approval is blocked by KYC checks; the admin rejects with a reason.',
  );
  const a3 = application('Fake Travels', { gstNumber: '12345' });
  const r3 = await apply('application submitted (the form accepts it; review catches it)', a3);
  await review(r3.body.applicationId, 'approve', undefined, 422);
  await review(
    r3.body.applicationId,
    'reject',
    'GSTIN 12345 is not a valid GST registration number',
  );
  await review(r3.body.applicationId, 'approve', undefined, 422);
  out('      ↳ a rejected application cannot be approved; it must be reopened first.');
  results.push(['Fake Travels', 'rejected', 'approve blocked (invalid GSTIN), rejected']);

  // 4 — GSTIN of another PAN
  step(
    4,
    'Mismatch Motors — GSTIN belongs to a different PAN, left pending',
    'Characters 3–12 of a GSTIN are the PAN; a mismatch blocks approval.',
  );
  const other = kyc();
  const a4 = application('Mismatch Motors', { gstNumber: other.gst });
  const r4 = await apply('application submitted', a4);
  await review(r4.body.applicationId, 'approve', undefined, 422);
  await review(
    r4.body.applicationId,
    'hold',
    'GSTIN is registered to a different PAN — send the correct GST certificate',
  );
  results.push(['Mismatch Motors', 'pending (on hold)', 'GSTIN / PAN mismatch blocks approval']);

  // 5 — duplicates at the form
  step(
    5,
    'Duplicate applications — refused at the form',
    'The same email, mobile, GSTIN or PAN cannot apply while another application is pending or approved.',
  );
  await apply('same email as Sharma Travels', application('Sharma Copy', { email: a1.email }), 409);
  await apply('same mobile as Rathore', application('Rathore Copy', { mobile: a2.mobile }), 409);
  await apply(
    'same GSTIN + PAN as Sharma',
    application('Gst Copy', { gstNumber: a1.gstNumber, panNumber: a1.panNumber }),
    409,
  );
  await apply(
    'bad email and short password',
    application('Broken Form', { email: 'not-an-email', password: '123' }),
    400,
  );
  results.push([
    '(duplicates)',
    'refused',
    'email / mobile / GSTIN clash → 409; invalid form → 400',
  ]);

  // 6 — no bank details
  step(
    6,
    'Highway Kings — no bank account, pending',
    'Settlements need a bank account: approval stays blocked until it is added.',
  );
  const a6 = application('Highway Kings', {
    bankAccountHolder: undefined,
    bankAccountNumber: undefined,
    bankIfsc: undefined,
    bankName: undefined,
  });
  const r6 = await apply('application submitted without bank details', a6);
  await review(r6.body.applicationId, 'approve', undefined, 422);
  results.push(['Highway Kings', 'pending', 'no bank details → cannot approve yet']);

  // 7 — rejected for good
  step(7, 'Night Rider Roadways — rejected', 'Operator does not meet the platform requirements.');
  const r7 = await apply('application submitted', application('Night Rider Roadways'));
  await review(
    r7.body.applicationId,
    'reject',
    'Fleet is older than the 15-year limit set by the platform',
  );
  results.push(['Night Rider Roadways', 'rejected', 'rejected with reason']);

  // 8 — reject, reopen, approve
  step(
    8,
    'Reopen Express — rejected, reopened, approved',
    'Mistakes happen: a rejected application can be reopened (with a reason) and approved.',
  );
  const a8 = application('Reopen Express');
  const r8 = await apply('application submitted', a8);
  await review(
    r8.body.applicationId,
    'reject',
    'Cancelled cheque is not readable, please resubmit',
  );
  await review(r8.body.applicationId, 'reopen', 'Operator sent a clear cheque copy by email');
  const ok8 = await review(r8.body.applicationId, 'approve', 'Cheque verified');
  await operatorLogin(a8, ok8.body.slug);
  results.push(['Reopen Express', 'approved', 'rejected → reopened → approved']);

  // 9 — approved, then suspended, then activated
  step(
    9,
    'Golden Wheels — approved, suspended, re-activated',
    'After go-live, control moves to the operator itself: suspend / activate.',
  );
  const a9 = application('Golden Wheels');
  const r9 = await apply('application submitted', a9);
  const ok9 = await review(r9.body.applicationId, 'approve');
  await operatorLogin(a9, ok9.body.slug);
  await call(
    'super admin suspends the operator',
    'POST',
    `/admin/tenants/${ok9.body.tenantId}/suspend`,
    {
      token: adminToken,
      body: { reason: 'Unpaid platform invoices for two months' },
    },
  );
  const blocked = await operatorLogin(a9, ok9.body.slug, 403);
  if (blocked.status !== 403) out('      ↳ note: login status while suspended shown above');
  await call(
    'super admin re-activates it',
    'POST',
    `/admin/tenants/${ok9.body.tenantId}/activate`,
    { token: adminToken },
  );
  await operatorLogin(a9, ok9.body.slug);
  results.push([
    'Golden Wheels',
    'approved → suspended → active',
    'suspended operator cannot sign in',
  ]);

  // 10 — left pending, untouched
  step(10, 'Royal Safar — new, waiting for review', 'Submitted and not yet reviewed.');
  await apply('application submitted', application('Royal Safar'));
  results.push(['Royal Safar', 'pending', 'awaiting review']);

  // 11 — the second way in: the super admin adds an operator directly
  step(
    11,
    'Metro Link Travels — added directly by the super admin',
    'No application: the platform provisions the operator and its owner login in one call.',
  );
  const slug = `metro-link-${run.toLowerCase()}`;
  const ownerEmail = `owner.${run.toLowerCase()}@metrolink.example.in`;
  await call('super admin provisions the operator', 'POST', '/admin/tenants', {
    token: adminToken,
    headers: { 'idempotency-key': `demo-${run}` },
    body: {
      slug,
      legalName: 'Metro Link Travels Pvt Ltd',
      displayName: 'Metro Link Travels',
      contactEmail: ownerEmail,
      owner: { fullName: 'Metro Owner', email: ownerEmail, password: 'Operator@123' },
    },
  });
  await operatorLogin({ email: ownerEmail, password: 'Operator@123' }, slug);
  await call('same slug again', 'POST', '/admin/tenants', {
    token: adminToken,
    headers: { 'idempotency-key': `demo-${run}-2` },
    body: {
      slug,
      legalName: 'Another Co',
      displayName: 'Another',
      contactEmail: `x.${run.toLowerCase()}@example.in`,
      owner: {
        fullName: 'X',
        email: `x.${run.toLowerCase()}@example.in`,
        password: 'Operator@123',
      },
    },
    expect: 409,
  });
  results.push([
    'Metro Link Travels',
    'active (direct)',
    'provisioned without an application; duplicate slug → 409',
  ]);

  step('✓', 'Queue as the super admin sees it', 'GET /admin/operator-applications?status=…');
  for (const s of ['pending', 'approved', 'rejected']) {
    const list = await call(
      `${s} applications`,
      'GET',
      `/admin/operator-applications?status=${s}`,
      { token: adminToken },
    );
    const names = (list.body.applications ?? [])
      .filter((a) => String(a.email ?? '').includes(run.toLowerCase()))
      .map((a) => a.companyName);
    out(`      ${s}: ${names.join(', ') || '—'}`);
  }

  out('');
  out('## Summary');
  out('');
  out('| Operator | Final state | Edge case shown |');
  out('|---|---|---|');
  for (const [n, s, e] of results) out(`| ${n} | ${s} | ${e} |`);
  writeFileSync('onboarding-demo.md', `${md.join('\n')}\n`);
  process.stdout.write('\nSaved: onboarding-demo.md\n');
}

main().catch((e) => {
  process.stderr.write(`\n✖ ${e.message}\n`);
  process.exit(1);
});
