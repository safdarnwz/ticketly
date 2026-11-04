import { useCallback, useEffect, useState } from 'react';
import { api, inr } from './api';

interface LoanDetail {
  id: string; status: string; netDisbursalPaise: number; totalRepayablePaise: number; dueDate: string; coolingOffEndsOn: string | null;
  dues: { today: string; daysUsed: number; interestTillTodayPaise: number; contractualPaise: number; penalPaise: number; paidPaise: number; outstandingPaise: number; overdueDays: number; phase: string } | null;
  payments: { id: string; status: string; amountPaise: number; paidPaise: number; method: string | null; utr: string | null; paidAt: string | null; receiptNo: string | null }[];
  howToPay: string;
}

const PHASE: Record<string, string> = {
  COOLING_OFF: 'Cooling-off period: you can exit now with no penalty, paying only interest for the days used.',
  BEFORE_DUE: 'Repay early any time. Interest is charged only for the days used.',
  DUE_TODAY: 'Your repayment is due today.',
  OVERDUE: 'Your repayment is overdue. Penal charges are added each day until you pay.',
  PAID: 'Fully repaid. Thank you!',
};

/** Borrower's loan and self-service repayment. No auto-debit: the borrower pays by UPI, net banking or card. */
export function LoanView({ loanId, token }: { loanId: string; token: string }) {
  const [l, setL] = useState<LoanDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState<{ paymentId: string; amountPaise: number; paymentUrl: string; upiIntentUrl: string | null } | null>(null);

  const load = useCallback(async () => setL(await api<LoanDetail>(`/loans/${loanId}`, { token })), [loanId, token]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // While a payment is open, keep checking for confirmation.
  useEffect(() => {
    if (!pay) return;
    const t = setInterval(async () => {
      const d = await api<LoanDetail>(`/loans/${loanId}/payments/${pay.paymentId}/refresh`, { token, method: 'POST' }).catch(() => null);
      if (d) {
        setL(d);
        const p = d.payments.find((x) => x.id === pay.paymentId);
        if (p && p.status !== 'CREATED') setPay(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [pay, loanId, token]);

  if (!l) return <div className="center">{error ? <div className="error">{error}</div> : <div className="spinner" />}</div>;
  const d = l.dues;
  const open = l.status === 'ACTIVE' || l.status === 'OVERDUE';

  const startPay = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api(`/loans/${loanId}/payments`, { token, body: amount ? { amount: Number(amount) } : {} });
      setPay(r);
      setAmount('');
      if (!r.paymentUrl.includes('#sandbox-pay/')) window.location.href = r.paymentUrl;
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h2>Your loan</h2>
      {error && <div className="error" role="alert">{error}</div>}
      {d && (
        <>
          <div className={`due ${d.phase.toLowerCase()}`}>
            <div className="muted">{d.phase === 'PAID' ? 'Outstanding' : 'Amount to pay today'}</div>
            <div className="amount">{inr(d.outstandingPaise)}</div>
            <div className="muted">{PHASE[d.phase]}</div>
          </div>
          <dl className="kv">
            <dt>Due date</dt><dd>{l.dueDate}{d.overdueDays ? ` (${d.overdueDays} days overdue)` : ''}</dd>
            <dt>Amount on due date</dt><dd>{inr(l.totalRepayablePaise)}</dd>
            <dt>Interest so far</dt><dd>{inr(d.interestTillTodayPaise)} ({d.daysUsed} day{d.daysUsed > 1 ? 's' : ''})</dd>
            {d.penalPaise > 0 && <><dt>Penal charges</dt><dd>{inr(d.penalPaise)}</dd></>}
            <dt>Paid so far</dt><dd>{inr(d.paidPaise)}</dd>
          </dl>
        </>
      )}

      {open && !pay && (
        <div className="pay-box">
          <label className="field"><span>Amount (leave blank to pay everything)</span>
            <input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={d ? String(d.outstandingPaise / 100) : ''} /></label>
          <button disabled={busy} onClick={startPay}>{busy ? 'Please wait…' : 'Pay by UPI / net banking / card'}</button>
          <p className="muted">{l.howToPay}</p>
        </div>
      )}

      {pay && (
        pay.paymentUrl.includes('#sandbox-pay/')
          ? <SandboxPay orderId={pay.paymentUrl.split('/').pop()!} amountPaise={pay.amountPaise} onDone={() => { setPay(null); load(); }} />
          : <div className="notice">Complete the payment on the payment page. {pay.upiIntentUrl && <a href={pay.upiIntentUrl}>Open UPI app</a>}</div>
      )}

      {l.payments.length > 0 && (
        <>
          <h3>Payments</h3>
          <table className="kfs">
            <tbody>
              {l.payments.map((p) => (
                <tr key={p.id}><th>{p.paidAt ? new Date(p.paidAt).toLocaleString() : 'Started'}</th>
                  <td>{inr(p.status === 'PAID' ? p.paidPaise : p.amountPaise)} · {p.status}{p.method ? ` · ${p.method}` : ''}{p.receiptNo ? ` · ${p.receiptNo}` : ''}{p.utr ? ` · UTR ${p.utr}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Sandbox stand-in for the payment gateway page. */
function SandboxPay({ orderId, amountPaise, onDone }: { orderId: string; amountPaise: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async (outcome: 'PAID' | 'FAILED', method: string) => {
    setBusy(true);
    try { await api(`/sandbox/payments/${orderId}/pay`, { body: { outcome, method } }); onDone(); } finally { setBusy(false); }
  };
  return (
    <div className="sandbox-box">
      <div className="sandbox">Sandbox payment page (gateway simulator). Pay {inr(amountPaise)}:</div>
      <div className="row-actions">
        <button className="inline" disabled={busy} onClick={() => go('PAID', 'UPI')}>Pay with UPI</button>
        <button className="inline" disabled={busy} onClick={() => go('PAID', 'NETBANKING')}>Net banking</button>
        <button className="inline" disabled={busy} onClick={() => go('PAID', 'DEBIT_CARD')}>Debit card</button>
        <button className="inline secondary" disabled={busy} onClick={() => go('FAILED', 'UPI')}>Simulate failure</button>
      </div>
    </div>
  );
}
