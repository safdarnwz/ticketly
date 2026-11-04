import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, deviceId, inr, mmss } from './api';
import { OwnerPanel } from './OwnerPanel';
import type { AppStatus } from './types';

type Screen = 'mobile' | 'otp' | 'kyc' | 'bank' | 'assess' | 'kfs' | 'esign' | 'disbursing' | 'done' | 'review' | 'rejected' | 'failed' | 'expired';

const screenFor = (s: string): Screen =>
  (({
    STARTED: 'kyc', KYC_VERIFIED: 'bank', BANK_VERIFIED: 'assess', APPROVED: 'kfs', KFS_ACCEPTED: 'esign', ESIGN_PENDING: 'esign',
    DISBURSING: 'disbursing', DISBURSED: 'done', MANUAL_REVIEW: 'review', REJECTED: 'rejected', DISBURSAL_FAILED: 'failed', EXPIRED: 'expired',
  }) as Record<string, Screen>)[s] ?? 'kyc';

const REASON_TEXT: Record<string, string> = {
  KYC_PAN_INVALID: 'PAN could not be verified.',
  KYC_NAME_MISMATCH: 'Name does not match PAN records.',
  BUREAU_SCORE_LOW: 'Credit score is below our minimum.',
  BUREAU_WRITE_OFF_OR_SETTLED: 'Credit report shows a written-off or settled loan.',
  BUREAU_DPD_90_PLUS: 'Credit report shows a payment overdue by 90+ days.',
  INSUFFICIENT_REPAYMENT_CAPACITY: 'Your income after EMIs is not enough for the minimum loan.',
  INCOME_BELOW_MINIMUM: 'Monthly income is below our minimum.',
  AGE_OUT_OF_RANGE: 'Age must be between 21 and 58.',
  ACTIVE_LOAN_OR_APPLICATION_EXISTS: 'You already have an active loan or application.',
};

export function App() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const f = () => setRoute(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return route === '#owner' ? <OwnerPanel /> : <CustomerJourney />;
}

function CustomerJourney() {
  const [screen, setScreen] = useState<Screen>('mobile');
  const [token, setToken] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; sandboxOtp?: string } | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [st, setSt] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async (id = appId, tok = token) => {
    if (!id || !tok) return;
    const s = await api<AppStatus>(`/applications/${id}`, { token: tok });
    setSt(s);
    setScreen(screenFor(s.status));
    return s;
  }, [appId, token]);

  // Poll while money is on its way.
  useEffect(() => {
    if (screen !== 'disbursing') return;
    const t = setInterval(() => refresh().catch(() => undefined), 1500);
    return () => clearInterval(t);
  }, [screen, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const step = (path: string, body: unknown) =>
    run(async () => {
      await api(`/applications/${appId}/${path}`, { token, body });
      await refresh();
    });

  const elapsed = st ? (st.status === 'DISBURSED' ? st.elapsedMs : now - new Date(st.journeyStartedAt).getTime()) : 0;
  const target = st?.targetMs ?? 300_000;
  const stopped = st && ['DISBURSED', 'REJECTED', 'MANUAL_REVIEW', 'DISBURSAL_FAILED', 'EXPIRED'].includes(st.status);

  return (
    <div className="page">
      <header>
        <div className="brand">Instant Loan</div>
        <div className="tagline">Money in your bank account in about 5 minutes*</div>
      </header>

      {st && (
        <div className={`timer ${elapsed > target ? 'late' : ''}`}>
          <span className="clock">{mmss(stopped ? st.elapsedMs : elapsed)}</span>
          <span className="of">/ {mmss(target)} target</span>
          <div className="bar"><div style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} /></div>
        </div>
      )}

      <main>
        <div className="card">
          {error && <div className="error" role="alert">{error}</div>}

          {screen === 'mobile' && (
            <Form title="Login with mobile number" busy={busy} cta="Send OTP"
              onSubmit={() => run(async () => {
                const r = await api('/auth/otp/request', { body: { mobile } });
                setChallenge({ id: r.challengeId, sandboxOtp: r.sandboxOtp });
                setScreen('otp');
              })}>
              <Field label="Mobile number"><input inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} placeholder="98XXXXXXXX" required autoFocus /></Field>
            </Form>
          )}

          {screen === 'otp' && challenge && (
            <OtpForm hint={challenge.sandboxOtp} busy={busy}
              onSubmit={(otp) => run(async () => {
                const v = await api('/auth/otp/verify', { body: { mobile, challengeId: challenge.id, otp } });
                setToken(v.accessToken);
                const a = await api('/applications', { token: v.accessToken, body: { deviceId: deviceId() } });
                setAppId(a.id);
                await refresh(a.id, v.accessToken);
              })} />
          )}

          {screen === 'kyc' && <KycForm busy={busy} onSubmit={(b) => step('kyc', b)} />}
          {screen === 'bank' && <BankForm busy={busy} onSubmit={(b) => step('bank-account', b)} />}
          {screen === 'assess' && <AssessForm busy={busy} onSubmit={(b) => step('assessment', b)} />}
          {screen === 'kfs' && appId && <KfsView appId={appId} token={token!} busy={busy} onAccept={(hash) => step('kfs/accept', { kfsHash: hash, consentKfs: true })} />}
          {screen === 'esign' && st && (
            <EsignForm busy={busy} pending={st.status === 'ESIGN_PENDING'}
              onStart={() => step('esign/initiate', {})}
              onSign={(otp) => step('esign/complete', { otp })} />
          )}

          {screen === 'disbursing' && (
            <div className="center">
              <div className="spinner" />
              <h2>Sending money to your bank…</h2>
              <p>Transfer by {st?.payouts.at(-1)?.rail ?? 'IMPS'}. This usually takes a few seconds.</p>
            </div>
          )}

          {screen === 'done' && st?.loan && (
            <div className="center">
              <div className="tick">✓</div>
              <h2>{inr(st.loan.netDisbursalPaise)} sent to your account</h2>
              <p className="big">in {mmss(st.elapsedMs)} {st.withinTarget ? '— within 5 minutes' : ''}</p>
              <dl className="kv">
                <dt>UTR / reference</dt><dd>{st.payouts.find((p) => p.status === 'SUCCESS')?.utr}</dd>
                <dt>Repay</dt><dd>{inr(st.loan.totalRepayablePaise)}</dd>
                <dt>Due date</dt><dd>{st.loan.dueDate}</dd>
                <dt>Cooling-off ends</dt><dd>{st.loan.coolingOffEndsOn} (exit without penalty until then)</dd>
              </dl>
            </div>
          )}

          {screen === 'review' && <Message title="Your application is with our credit team" text="It needs a short manual check. We will SMS you, usually within a few working hours. Your offer will be shown here." />}
          {screen === 'rejected' && <Message title="We cannot offer a loan right now" text={(st?.reasons ?? []).map((r) => REASON_TEXT[r] ?? r).join(' ') || 'Your application did not meet our criteria.'} />}
          {screen === 'failed' && <Message title="Transfer could not be completed" text="Your bank did not accept the transfer. The loan has been cancelled and you owe nothing. Please try again with another account." />}
          {screen === 'expired' && <Message title="This application expired" text="Please log in again to start a new one." />}
        </div>

        {st && <Timeline st={st} />}
      </main>

      <footer>
        *Target time, not a guarantee. KYC, credit bureau, bank verification, e-sign or banking network delays can make it longer.
        The lender sends money directly to your verified account. No hidden charges: everything is in the Key Fact Statement.
        <br /><a href="#owner">Owner login</a>
      </footer>
    </div>
  );
}

function Timeline({ st }: { st: AppStatus }) {
  return (
    <aside className="timeline card">
      <h3>Your 5-minute journey</h3>
      <ol>
        {st.steps.map((s) => (
          <li key={s.step} className={s.outcome ? s.outcome.toLowerCase() : 'todo'}>
            <span className="t">{mmss(s.startsAtSec * 1000)}</span>
            <span className="l">{s.label}</span>
            <span className="d">{s.durationMs != null ? `${(s.durationMs / 1000).toFixed(1)}s` : ''}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Form({ title, cta, busy, onSubmit, children }: { title: string; cta: string; busy: boolean; onSubmit: () => void; children: ReactNode }) {
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
      <h2>{title}</h2>
      {children}
      <button disabled={busy}>{busy ? 'Please wait…' : cta}</button>
    </form>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

const Message = ({ title, text }: { title: string; text: string }) => (
  <div className="center"><h2>{title}</h2><p>{text}</p></div>
);

function OtpForm({ hint, busy, onSubmit }: { hint?: string; busy: boolean; onSubmit: (otp: string) => void }) {
  const [otp, setOtp] = useState('');
  return (
    <Form title="Enter OTP" cta="Verify & continue" busy={busy} onSubmit={() => onSubmit(otp)}>
      <Field label="6-digit OTP sent by SMS"><input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
      {hint && <p className="sandbox">Sandbox OTP: <b>{hint}</b></p>}
    </Form>
  );
}

function KycForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ pan: '', fullName: '', dateOfBirth: '', consentKyc: false });
  return (
    <Form title="Verify your identity" cta="Verify KYC" busy={busy} onSubmit={() => onSubmit(f)}>
      <Field label="PAN"><input value={f.pan} maxLength={10} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" required autoFocus /></Field>
      <Field label="Full name as on PAN"><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /></Field>
      <Field label="Date of birth"><input type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} required /></Field>
      <label className="check"><input type="checkbox" checked={f.consentKyc} onChange={(e) => setF({ ...f, consentKyc: e.target.checked })} required />
        I agree to the lender verifying my PAN and fetching my KYC records from CKYC for this loan.</label>
      <p className="sandbox">Sandbox: PAN digits 0001–5999 approve, 6xxx manual review, 7xxx/8xxx reject. Last letter Z = invalid.</p>
    </Form>
  );
}

function BankForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ accountNumber: '', ifsc: '' });
  return (
    <Form title="Bank account for the money" cta="Verify account" busy={busy} onSubmit={() => onSubmit(f)}>
      <Field label="Account number"><input inputMode="numeric" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })} required autoFocus /></Field>
      <Field label="IFSC"><input value={f.ifsc} maxLength={11} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" required /></Field>
      <p className="muted">The account must be in your own name. We send ₹1 to check it.</p>
      <p className="sandbox">Sandbox: ending 0000 = not found, 1111 = other name, 2222 = IMPS down (NEFT fallback), 3333 = account closed.</p>
    </Form>
  );
}

function AssessForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({ requestedAmount: 20000, monthlyIncome: 50000, existingMonthlyEmi: 0, employmentType: 'SALARIED', consentBureau: false });
  return (
    <Form title="How much do you need?" cta="Check my offer" busy={busy} onSubmit={() => onSubmit(f)}>
      <Field label={`Loan amount: ${inr(f.requestedAmount * 100)}`}>
        <input type="range" min={10000} max={30000} step={1000} value={f.requestedAmount} onChange={(e) => setF({ ...f, requestedAmount: Number(e.target.value) })} />
      </Field>
      <Field label="Monthly take-home income (₹)"><input type="number" min={0} value={f.monthlyIncome} onChange={(e) => setF({ ...f, monthlyIncome: Number(e.target.value) })} required /></Field>
      <Field label="Current EMIs per month (₹)"><input type="number" min={0} value={f.existingMonthlyEmi} onChange={(e) => setF({ ...f, existingMonthlyEmi: Number(e.target.value) })} required /></Field>
      <Field label="Employment">
        <select value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}>
          <option value="SALARIED">Salaried</option>
          <option value="SELF_EMPLOYED">Self-employed</option>
        </select>
      </Field>
      <label className="check"><input type="checkbox" checked={f.consentBureau} onChange={(e) => setF({ ...f, consentBureau: e.target.checked })} required />
        I agree to the lender fetching my credit report from a credit bureau for this application.</label>
    </Form>
  );
}

function KfsView({ appId, token, busy, onAccept }: { appId: string; token: string; busy: boolean; onAccept: (hash: string) => void }) {
  const [data, setData] = useState<{ kfs: any; kfsHash: string } | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { api(`/applications/${appId}/kfs`, { token }).then(setData); }, [appId, token]);
  if (!data) return <div className="center"><div className="spinner" /></div>;
  const k = data.kfs;
  return (
    <div>
      <h2>Key Fact Statement</h2>
      <p className="muted">Read this before you sign. Offer valid until {new Date(k.validUntil).toLocaleTimeString()}.</p>
      <table className="kfs">
        <tbody>
          {k.offerName && <tr className="hl"><th>Your offer</th><td>{k.offerName}</td></tr>}
          <tr><th>Lender</th><td>{k.lender}</td></tr>
          <tr><th>Loan amount</th><td>{k.loan.sanctionedAmount}</td></tr>
          {k.charges.map((c: any) => <tr key={c.item}><th>{c.item}</th><td>{c.amount} (deducted upfront)</td></tr>)}
          <tr className="hl"><th>You receive</th><td>{k.netDisbursal} in account XXXX{k.disbursalAccount.last4}</td></tr>
          <tr><th>Interest: {k.interest.rate}</th><td>{k.interest.amount}</td></tr>
          <tr className="hl"><th>Total you repay</th><td>{k.totalAmountPayable} in one payment</td></tr>
          <tr><th>When</th><td>{k.loan.dueDateRule} (about {k.loan.estimatedDueDateIfDisbursedToday})</td></tr>
          <tr><th>Total cost of credit</th><td>{k.totalCostOfCredit}</td></tr>
          <tr className="hl"><th>Annual Percentage Rate (APR)</th><td>{k.aprPercent}%</td></tr>
          <tr><th>Penal charges</th><td>{k.penalCharges}</td></tr>
          <tr><th>Cooling-off</th><td>{k.coolingOff}</td></tr>
          <tr><th>Recovery</th><td>{k.recovery}</td></tr>
          <tr><th>Lending service provider</th><td>{k.lendingServiceProvider}</td></tr>
          <tr><th>Grievance</th><td>{k.grievanceRedressal}</td></tr>
        </tbody>
      </table>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        I have read and understood the Key Fact Statement, including the APR and all charges.</label>
      <button disabled={!ok || busy} onClick={() => onAccept(data.kfsHash)}>Accept & continue to e-sign</button>
    </div>
  );
}

function EsignForm({ busy, pending, onStart, onSign }: { busy: boolean; pending: boolean; onStart: () => void; onSign: (otp: string) => void }) {
  const [otp, setOtp] = useState('');
  if (!pending)
    return (
      <div>
        <h2>Sign your loan agreement</h2>
        <p>You will sign with an Aadhaar OTP. The money is sent the moment you sign.</p>
        <button disabled={busy} onClick={onStart}>Start e-sign</button>
      </div>
    );
  return (
    <Form title="Enter e-sign OTP" cta="Sign & get money" busy={busy} onSubmit={() => onSign(otp)}>
      <Field label="OTP"><input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
      <p className="sandbox">Sandbox e-sign OTP: <b>123456</b></p>
    </Form>
  );
}
