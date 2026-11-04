import { FormEvent, useState } from 'react';
import { api } from './api';
import { DigioSession, runDigio } from './digio';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** KYC with DigiLocker through Digio: Aadhaar and PAN are fetched from the customer's DigiLocker. */
export function KycStep({ appId, token, onChange }: { appId: string; token: string; onChange: () => Promise<unknown> }) {
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState<DigioSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** After the SDK returns, ask our server to read the verified result (Digio may take a few seconds). */
  const complete = async () => {
    for (let i = 0; i < 20; i++) {
      const r = await api(`/applications/${appId}/kyc/complete`, { token, method: 'POST' });
      if (r.retry) { setSession(null); setError(r.message); return; }
      if (r.kyc !== 'PENDING') return onChange();
      setMsg('Waiting for DigiLocker to confirm…');
      await sleep(3000);
    }
    setMsg('Still waiting for DigiLocker. You can close this page; we will continue when it confirms.');
  };

  const start = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api(`/applications/${appId}/kyc/start`, { token, body: { consentKyc: true } });
      if (r.status !== 'STARTED') return void (await onChange());
      setSession(r.kyc);
      if (r.kyc.provider === 'digio') {
        const res = await runDigio(r.kyc);
        if (res.errorCode) setMsg('DigiLocker was closed before finishing. Checking status…');
        await complete();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Verify your identity with DigiLocker</h2>
      <p className="muted">We fetch your Aadhaar and PAN from your DigiLocker through Digio. You log in to DigiLocker with your Aadhaar OTP. We never see your DigiLocker password, and we keep only the last 4 digits of your Aadhaar.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {msg && <div className="notice">{msg}</div>}
      {!session || session.provider === 'digio' ? (
        <>
          <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree to share my Aadhaar and PAN from DigiLocker with the lender for KYC for this loan.</label>
          <button disabled={!consent || busy} onClick={start}>{busy ? 'Please wait…' : 'Verify with DigiLocker'}</button>
        </>
      ) : (
        <SandboxDigiLocker requestId={session.requestId} onDone={async () => { setBusy(true); try { await complete(); } finally { setBusy(false); } }} />
      )}
    </div>
  );
}

/** Sandbox stand-in for the DigiLocker screen: the tester types what DigiLocker would return. */
function SandboxDigiLocker({ requestId, onDone }: { requestId: string; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ pan: '', fullName: '', dateOfBirth: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="sandbox-box" onSubmit={async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      try {
        await api(`/sandbox/ekyc/${requestId}/complete`, { body: f });
        await onDone();
      } catch (err) { setError((err as Error).message); }
    }}>
      <div className="sandbox">Sandbox DigiLocker (Digio simulator). Live mode opens Digio here. PAN digits 0001–5999 approve, 6xxx manual review, 7xxx/8xxx reject; last letter Z = KYC rejected.</div>
      {error && <div className="error">{error}</div>}
      <label className="field"><span>PAN in DigiLocker</span><input value={f.pan} maxLength={10} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" required autoFocus /></label>
      <label className="field"><span>Name on Aadhaar</span><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /></label>
      <label className="field"><span>Date of birth on Aadhaar</span><input type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} required /></label>
      <button>Allow and share</button>
    </form>
  );
}

/** Aadhaar eSign of the loan agreement through Digio. Signing starts the payout immediately. */
export function EsignStep({ appId, token, onChange }: { appId: string; token: string; onChange: () => Promise<unknown> }) {
  const [session, setSession] = useState<DigioSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');

  const complete = async () => {
    const s = await api(`/applications/${appId}/esign/complete`, { token, method: 'POST' });
    if (s.status === 'ESIGN_PENDING') setError('The agreement is not signed yet. Please complete the Aadhaar eSign.');
    await onChange();
  };

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api(`/applications/${appId}/esign/initiate`, { token, method: 'POST' });
      setSession(r.esign);
      if (r.esign.provider === 'digio') {
        await runDigio(r.esign);
        await complete();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const res = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/applications/${appId}/agreement.pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return setError('Could not download the agreement');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `loan-agreement-${appId}.pdf` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2>Sign your loan agreement</h2>
      <p>You sign with Aadhaar OTP through Digio. The money is sent the moment you sign.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {session && <p><button type="button" className="link" onClick={download}>Download the agreement (PDF)</button></p>}
      {!session || session.provider === 'digio' ? (
        <button disabled={busy} onClick={start}>{busy ? 'Please wait…' : session ? 'Open Aadhaar eSign again' : 'Sign with Aadhaar eSign'}</button>
      ) : (
        <form className="sandbox-box" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try {
            await api(`/sandbox/esign/${session.requestId}/sign`, { body: { otp } });
            await complete();
          } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>
          <div className="sandbox">Sandbox Aadhaar eSign (Digio simulator). OTP: <b>123456</b></div>
          <label className="field"><span>Aadhaar OTP</span><input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus /></label>
          <button disabled={busy}>{busy ? 'Signing…' : 'Sign & get money'}</button>
        </form>
      )}
    </div>
  );
}
