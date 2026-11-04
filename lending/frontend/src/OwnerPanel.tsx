import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, inr } from './api';

interface Plan {
  id: string; name: string; scope: 'ALL' | 'CUSTOMER'; customerMobile: string | null; customerLabel: string | null;
  priority: number; active: boolean; validFrom: string | null; validUntil: string | null; maxUses: number | null; usedCount: number;
  interestUnit: 'PER_DAY' | 'PER_ANNUM'; interestRatePercent: number; feeType: 'PERCENT' | 'FLAT'; feeValue: number; gstPercent: number;
  tenureDays: number; minPrincipalPaise: number; maxPrincipalPaise: number; penalType: 'NONE' | 'PERCENT_PER_DAY' | 'FLAT_PER_DAY';
  penalValue: number; coolingOffDays: number; aprCapPercent: number | null; updatedAt: string;
}

type FormState = Record<string, string | boolean>;

const EMPTY: FormState = {
  name: '', scope: 'ALL', customerMobile: '', customerLabel: '', priority: '0', active: true, validFrom: '', validUntil: '', maxUses: '',
  interestUnit: 'PER_DAY', interestRatePercent: '0.05', feeType: 'PERCENT', feeValue: '1', gstPercent: '18', tenureDays: '30',
  minAmount: '10000', maxAmount: '30000', penalType: 'NONE', penalValue: '0', coolingOffDays: '3', aprCapPercent: '',
};

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

function planToForm(p: Plan): FormState {
  return {
    name: p.name, scope: p.scope, customerMobile: p.customerMobile ?? '', customerLabel: p.customerLabel ?? '', priority: String(p.priority),
    active: p.active, validFrom: toLocal(p.validFrom), validUntil: toLocal(p.validUntil), maxUses: p.maxUses == null ? '' : String(p.maxUses),
    interestUnit: p.interestUnit, interestRatePercent: String(p.interestRatePercent), feeType: p.feeType, feeValue: String(p.feeValue),
    gstPercent: String(p.gstPercent), tenureDays: String(p.tenureDays), minAmount: String(p.minPrincipalPaise / 100), maxAmount: String(p.maxPrincipalPaise / 100),
    penalType: p.penalType, penalValue: String(p.penalValue), coolingOffDays: String(p.coolingOffDays), aprCapPercent: p.aprCapPercent == null ? '' : String(p.aprCapPercent),
  };
}

function formToBody(f: FormState) {
  const n = (k: string) => Number(f[k]);
  const opt = (k: string) => (f[k] === '' ? null : Number(f[k]));
  const date = (k: string) => (f[k] ? new Date(f[k] as string).toISOString() : null);
  return {
    name: f.name, scope: f.scope, customerMobile: f.scope === 'CUSTOMER' ? f.customerMobile : null, customerLabel: f.customerLabel || null,
    priority: n('priority'), active: f.active, validFrom: date('validFrom'), validUntil: date('validUntil'), maxUses: opt('maxUses'),
    interestUnit: f.interestUnit, interestRatePercent: n('interestRatePercent'), feeType: f.feeType, feeValue: n('feeValue'), gstPercent: n('gstPercent'),
    tenureDays: n('tenureDays'), minAmount: n('minAmount'), maxAmount: n('maxAmount'), penalType: f.penalType, penalValue: n('penalValue'),
    coolingOffDays: n('coolingOffDays'), aprCapPercent: opt('aprCapPercent'),
  };
}

const rateText = (p: Plan) => `${p.interestRatePercent}% ${p.interestUnit === 'PER_DAY' ? '/day' : '/year'}`;
const feeText = (p: Plan) => (p.feeType === 'PERCENT' ? `${p.feeValue}%` : inr(p.feeValue * 100));

function status(p: Plan) {
  const now = Date.now();
  if (!p.active) return 'Off';
  if (p.validFrom && new Date(p.validFrom).getTime() > now) return 'Scheduled';
  if (p.validUntil && new Date(p.validUntil).getTime() <= now) return 'Ended';
  if (p.maxUses != null && p.usedCount >= p.maxUses) return 'Used up';
  return 'Live';
}

export function OwnerPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isOwner = roles.includes('OWNER');

  const load = useCallback(async (t = token) => {
    if (t) setPlans(await api<Plan[]>('/admin/pricing-plans', { token: t }));
  }, [token]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  if (!token) return <StaffLogin onLogin={(t, r) => { setToken(t); setRoles(r); }} />;

  return (
    <div className="page owner">
      <header>
        <div className="brand">Pricing & offers</div>
        <div className="tagline">{isOwner ? 'Only you (owner) can change these. Changes apply to new offers immediately; loans already offered or signed keep their terms.' : 'View only. Only the owner can change pricing.'}</div>
      </header>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {isOwner && !editing && (
        <div className="row-actions">
          <button className="inline" onClick={() => setEditing({ id: null, form: { ...EMPTY, name: 'Offer for all customers' } })}>+ Offer for all customers</button>
          <button className="inline" onClick={() => setEditing({ id: null, form: { ...EMPTY, scope: 'CUSTOMER', name: 'Personal offer', customerLabel: 'Special rate for you', maxUses: '1', priority: '0' } })}>+ Offer for one customer</button>
        </div>
      )}

      {editing && (
        <PlanForm
          initial={editing.form}
          isNew={!editing.id}
          onCancel={() => setEditing(null)}
          onSave={async (form, code) => {
            setError(null);
            try {
              const path = editing.id ? `/admin/pricing-plans/${editing.id}` : '/admin/pricing-plans';
              const res = await fetchWithTotp(path, editing.id ? 'PATCH' : 'POST', token, formToBody(form), code);
              setNotice(`Saved “${res.name}”. New offers use it from now.`);
              setEditing(null);
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}

      <div className="card table-wrap">
        <table className="plans">
          <thead>
            <tr><th>Status</th><th>Name</th><th>For</th><th>Interest</th><th>Fee</th><th>Amount</th><th>Days</th><th>Valid</th><th>Used</th><th /></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={status(p) === 'Live' ? '' : 'dim'}>
                <td><span className={`pill ${status(p).replace(' ', '').toLowerCase()}`}>{status(p)}</span></td>
                <td>{p.name}{p.customerLabel && <div className="muted">“{p.customerLabel}”</div>}</td>
                <td>{p.scope === 'ALL' ? 'All customers' : p.customerMobile}</td>
                <td>{rateText(p)}</td>
                <td>{feeText(p)} + {p.gstPercent}% GST</td>
                <td>{inr(p.minPrincipalPaise)}–{inr(p.maxPrincipalPaise)}</td>
                <td>{p.tenureDays}</td>
                <td className="muted">{p.validFrom || p.validUntil ? `${p.validFrom ? new Date(p.validFrom).toLocaleDateString() : '…'} → ${p.validUntil ? new Date(p.validUntil).toLocaleDateString() : '…'}` : 'Always'}</td>
                <td>{p.usedCount}{p.maxUses != null ? ` / ${p.maxUses}` : ''}</td>
                <td>{isOwner && <button className="link" onClick={() => setEditing({ id: p.id, form: planToForm(p) })}>Edit</button>}</td>
              </tr>
            ))}
            {!plans.length && <tr><td colSpan={10} className="muted">No plans yet. Lending is paused until you add an offer for all customers.</td></tr>}
          </tbody>
        </table>
      </div>

      <Preview token={token} />
    </div>
  );
}

async function fetchWithTotp(path: string, method: string, token: string, body: unknown, code: string) {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-totp': code },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join('. ') : data.message ?? `Failed (${res.status})`);
  return data;
}

function StaffLogin({ onLogin }: { onLogin: (token: string, roles: string[]) => void }) {
  const [f, setF] = useState({ email: '', password: '', totp: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="page">
      <header><div className="brand">Staff login</div><div className="tagline"><a href="#">← Customer site</a></div></header>
      <form className="card narrow" onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        try {
          const r = await api('/staff/login', { body: f });
          onLogin(r.accessToken, r.roles);
        } catch (err) { setError((err as Error).message); }
      }}>
        {error && <div className="error">{error}</div>}
        <L label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus /></L>
        <L label="Password"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></L>
        <L label="Authenticator code"><input inputMode="numeric" maxLength={6} value={f.totp} onChange={(e) => setF({ ...f, totp: e.target.value.replace(/\D/g, '') })} required /></L>
        <button>Log in</button>
      </form>
    </div>
  );
}

function PlanForm({ initial, isNew, onSave, onCancel }: { initial: FormState; isNew: boolean; onSave: (f: FormState, code: string) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState<FormState>(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: HTMLInputElement | HTMLSelectElement }) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const s = (k: string) => String(f[k]);

  // Live example so the owner sees the customer's cost before saving.
  const ex = (() => {
    const amt = Number(f.minAmount) && Number(f.maxAmount) ? Math.round((Number(f.minAmount) + Number(f.maxAmount)) / 2 / 1000) * 1000 : 20000;
    const daily = f.interestUnit === 'PER_DAY' ? Number(f.interestRatePercent) / 100 : Number(f.interestRatePercent) / 100 / 365;
    const fee = f.feeType === 'PERCENT' ? (amt * Number(f.feeValue)) / 100 : Number(f.feeValue);
    const gst = (fee * Number(f.gstPercent)) / 100;
    const net = amt - fee - gst;
    const interest = amt * daily * Number(f.tenureDays);
    const apr = net > 0 ? ((amt + interest - net) / net) * (365 / Number(f.tenureDays)) * 100 : NaN;
    return { amt, net, repay: amt + interest, apr };
  })();

  return (
    <form className="card plan-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(f, code); setBusy(false); }}>
      <h2>{isNew ? 'New offer' : 'Edit offer'}</h2>
      <div className="grid">
        <L label="Name (internal)"><input value={s('name')} onChange={set('name')} required /></L>
        <L label="Who gets it">
          <select value={s('scope')} onChange={set('scope')}>
            <option value="ALL">All customers</option>
            <option value="CUSTOMER">One customer (by mobile)</option>
          </select>
        </L>
        {f.scope === 'CUSTOMER' && <L label="Customer mobile"><input inputMode="numeric" maxLength={10} value={s('customerMobile')} onChange={set('customerMobile')} required /></L>}
        <L label="Label shown to customer (optional)"><input value={s('customerLabel')} onChange={set('customerLabel')} placeholder="e.g. Festival offer" /></L>

        <L label="Interest charged">
          <select value={s('interestUnit')} onChange={set('interestUnit')}>
            <option value="PER_DAY">% per day</option>
            <option value="PER_ANNUM">% per year</option>
          </select>
        </L>
        <L label={`Interest rate (% ${f.interestUnit === 'PER_DAY' ? 'per day' : 'per year'})`}><input type="number" step="any" min="0" value={s('interestRatePercent')} onChange={set('interestRatePercent')} required /></L>
        <L label="Processing fee type">
          <select value={s('feeType')} onChange={set('feeType')}>
            <option value="PERCENT">% of loan</option>
            <option value="FLAT">Flat ₹</option>
          </select>
        </L>
        <L label={f.feeType === 'PERCENT' ? 'Processing fee (%)' : 'Processing fee (₹)'}><input type="number" step="any" min="0" value={s('feeValue')} onChange={set('feeValue')} required /></L>
        <L label="GST on fee (%)"><input type="number" step="any" min="0" max="100" value={s('gstPercent')} onChange={set('gstPercent')} required /></L>
        <L label="Tenure (days)"><input type="number" min="1" max="365" value={s('tenureDays')} onChange={set('tenureDays')} required /></L>
        <L label="Min loan (₹)"><input type="number" min="1" value={s('minAmount')} onChange={set('minAmount')} required /></L>
        <L label="Max loan (₹)"><input type="number" min="1" value={s('maxAmount')} onChange={set('maxAmount')} required /></L>

        <L label="Penal charge after due date">
          <select value={s('penalType')} onChange={set('penalType')}>
            <option value="NONE">None</option>
            <option value="PERCENT_PER_DAY">% per day of overdue amount</option>
            <option value="FLAT_PER_DAY">Flat ₹ per day</option>
          </select>
        </L>
        {f.penalType !== 'NONE' && <L label="Penal charge value"><input type="number" step="any" min="0" value={s('penalValue')} onChange={set('penalValue')} /></L>}
        <L label="Cooling-off (days)"><input type="number" min="1" max="30" value={s('coolingOffDays')} onChange={set('coolingOffDays')} /></L>
        <L label="APR cap % (blank = no cap)"><input type="number" step="any" min="0" value={s('aprCapPercent')} onChange={set('aprCapPercent')} /></L>

        <L label="Valid from (blank = now)"><input type="datetime-local" value={s('validFrom')} onChange={set('validFrom')} /></L>
        <L label="Valid until (blank = no end)"><input type="datetime-local" value={s('validUntil')} onChange={set('validUntil')} /></L>
        <L label="Max loans on this offer (blank = unlimited)"><input type="number" min="1" value={s('maxUses')} onChange={set('maxUses')} /></L>
        <L label="Priority (higher wins)"><input type="number" value={s('priority')} onChange={set('priority')} /></L>
        <label className="check"><input type="checkbox" checked={f.active === true} onChange={set('active')} /> Offer is switched on</label>
      </div>

      <div className="example">
        Example on {inr(ex.amt * 100)}: customer receives <b>{Number.isFinite(ex.net) ? inr(Math.round(ex.net * 100)) : '—'}</b>, repays{' '}
        <b>{inr(Math.round(ex.repay * 100))}</b> after {s('tenureDays')} days. APR about <b>{Number.isFinite(ex.apr) ? ex.apr.toFixed(2) : '—'}%</b>.
      </div>

      <div className="save-row">
        <L label="Authenticator code to confirm"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></L>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Preview({ token }: { token: string }) {
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('20000');
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card preview" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try { setR(await api(`/admin/pricing-plans/preview?mobile=${mobile}&amount=${amount}`, { token })); } catch (err) { setError((err as Error).message); }
    }}>
      <h3>Check what a customer will be offered</h3>
      <div className="grid">
        <L label="Mobile"><input inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} required /></L>
        <L label="Amount (₹)"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required /></L>
      </div>
      <button className="inline">Check</button>
      {error && <div className="error">{error}</div>}
      {r && (
        <p>
          Plan: <b>{r.plan.name}</b> ({r.plan.scope === 'ALL' ? 'all customers' : 'personal'}).{' '}
          {r.offer ? <>Receives {inr(r.offer.netDisbursalPaise)}, repays {inr(r.offer.totalRepayablePaise)}, APR {(r.offer.aprBps / 100).toFixed(2)}%.</> : r.message}
        </p>
      )}
    </form>
  );
}

const L = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);
