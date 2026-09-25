import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Info, Landmark, Lock, Smartphone, User } from 'lucide-react';

import { Input, Select } from '@/components/ui';
import { paymentsApi, type ChargeInstrument, type PaymentMethod } from '@/lib/api/payments';
import { cn } from '@/lib/utils';

const METHODS: { value: PaymentMethod; label: string; icon: typeof CreditCard }[] = [
  { value: 'upi', label: 'UPI', icon: Smartphone },
  { value: 'credit_card', label: 'Credit card', icon: CreditCard },
  { value: 'debit_card', label: 'Debit card', icon: CreditCard },
  { value: 'net_banking', label: 'Net banking', icon: Landmark },
];

function luhnOk(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i -= 1) {
    let d = Number(num[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return num.length >= 12 && sum % 10 === 0;
}

function expiryOk(v: string): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

/**
 * Sandbox payment details (UPI / card / net banking). Reports a complete,
 * valid instrument — or null — to the parent, which decides when to charge.
 * Field problems show next to the field once the customer has typed there.
 */
export function PaymentMethodForm({ onChange, disabled }: {
  onChange: (instrument: ChargeInstrument | null) => void;
  disabled?: boolean;
}) {
  const methods = useQuery({ queryKey: ['test-methods'], queryFn: paymentsApi.testMethods, staleTime: 60_000 });
  const hints = methods.data?.hints ?? null;
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [f, setF] = useState({ vpa: '', card: '', expiry: '', cvv: '', holder: '', bank: '', user: '', pass: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setTouched((t) => ({ ...t, [k]: true }));
  };

  const card = f.card.replace(/\s/g, '');
  const errors: Record<string, string> = {};
  if (method === 'upi' && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(f.vpa.trim())) errors.vpa = 'Enter a UPI ID like name@bank';
  if (method === 'credit_card' || method === 'debit_card') {
    if (!/^\d{12,19}$/.test(card) || !luhnOk(card)) errors.card = 'Enter a valid card number';
    if (!expiryOk(f.expiry)) errors.expiry = 'MM/YY, not in the past';
    if (!/^\d{3,4}$/.test(f.cvv)) errors.cvv = '3 or 4 digits';
  }
  if (method === 'net_banking') {
    if (!f.bank) errors.bank = 'Choose your bank';
    if (!f.user.trim()) errors.user = 'Required';
    if (!f.pass) errors.pass = 'Required';
  }
  const valid = Object.keys(errors).length === 0;

  useEffect(() => {
    if (!valid) { onChange(null); return; }
    if (method === 'upi') onChange({ method, vpa: f.vpa.trim() });
    else if (method === 'net_banking') onChange({ method, bank: f.bank, username: f.user.trim(), password: f.pass });
    else onChange({ method, cardNumber: card, expiry: f.expiry.trim(), cvv: f.cvv, holder: f.holder.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report on every field change
  }, [valid, method, f.vpa, f.bank, f.user, f.pass, card, f.expiry, f.cvv, f.holder]);

  const err = (k: string) => (touched[k] ? errors[k] : undefined);

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Payment method">
        {METHODS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={method === value}
            onClick={() => { setMethod(value); setTouched({}); }}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors',
              method === value ? 'border-primary bg-primary/5 text-text' : 'border-border text-text-muted hover:border-primary/40 hover:text-text',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>

      {methods.data?.testMode && hints && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted p-3 text-xs text-text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <span className="font-semibold text-text">Test mode — no real money.</span>{' '}
            {method === 'upi' && <>UPI <b className="text-text">{hints.upi}</b> succeeds, <b>{hints.upiFailure}</b> is declined.</>}
            {(method === 'credit_card' || method === 'debit_card') && <>Card <b className="text-text">{hints.card}</b>, expiry <b className="text-text">{hints.cardExpiry}</b>, CVV <b className="text-text">{hints.cardCvv}</b>.</>}
            {method === 'net_banking' && <>Any bank, user <b className="text-text">{hints.netbankingUser}</b>, password <b className="text-text">{hints.netbankingPassword}</b>.</>}
          </div>
        </div>
      )}

      {method === 'upi' && (
        <Input label="UPI ID" value={f.vpa} onChange={set('vpa')} placeholder="name@bank" autoComplete="off" leftIcon={<Smartphone className="h-4 w-4" />} error={err('vpa')} />
      )}
      {(method === 'credit_card' || method === 'debit_card') && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Card number"
              value={f.card}
              onChange={(e) => set('card')({ target: { value: e.target.value.replace(/[^\d]/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ') } })}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 5678 9012 3456"
              leftIcon={<CreditCard className="h-4 w-4" />}
              error={err('card')}
            />
          </div>
          <Input
            label="Expiry (MM/YY)"
            value={f.expiry}
            onChange={(e) => {
              const d = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
              set('expiry')({ target: { value: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d } });
            }}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            error={err('expiry')}
          />
          <Input label="CVV" value={f.cvv} onChange={(e) => set('cvv')({ target: { value: e.target.value.replace(/[^\d]/g, '').slice(0, 4) } })} inputMode="numeric" type="password" autoComplete="cc-csc" placeholder="•••" error={err('cvv')} />
          <div className="sm:col-span-2">
            <Input label="Name on card (optional)" value={f.holder} onChange={set('holder')} autoComplete="cc-name" leftIcon={<User className="h-4 w-4" />} />
          </div>
        </div>
      )}
      {method === 'net_banking' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Select
              label="Bank"
              value={f.bank}
              onChange={(e) => set('bank')({ target: { value: e.target.value } })}
              placeholder="Select your bank"
              options={(methods.data?.banks ?? []).map((x) => ({ label: x, value: x }))}
              error={err('bank')}
            />
          </div>
          <Input label="User ID" value={f.user} onChange={set('user')} autoComplete="off" leftIcon={<User className="h-4 w-4" />} error={err('user')} />
          <Input label="Password" type="password" value={f.pass} onChange={set('pass')} autoComplete="off" leftIcon={<Lock className="h-4 w-4" />} error={err('pass')} />
        </div>
      )}
    </fieldset>
  );
}
