import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard, Phone, Mail, User, Lock, ShieldCheck, Loader2, Smartphone, Landmark, Info,
} from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Select, useToast } from '@/components/ui';
import { useBooking, type PassengerDraft } from '@/stores/booking';
import { useAuth } from '@/stores/auth';
import { authApi } from '@/lib/api/auth';
import { bookingsApi } from '@/lib/api/bookings';
import { paymentsApi, openRazorpayCheckout, type PaymentMethod, type ChargeInstrument } from '@/lib/api/payments';
import { ApiError } from '@/lib/api/client';
import { formatMoney, cn } from '@/lib/utils';

type AuthStep = 'mobile' | 'password' | 'register' | 'otp' | 'done';

const METHOD_META: { value: PaymentMethod; label: string; icon: typeof CreditCard }[] = [
  { value: 'upi', label: 'UPI', icon: Smartphone },
  { value: 'credit_card', label: 'Credit Card', icon: CreditCard },
  { value: 'debit_card', label: 'Debit Card', icon: CreditCard },
  { value: 'net_banking', label: 'Net Banking', icon: Landmark },
];

export function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const b = useBooking();
  const token = useAuth((s) => s.token);
  const doLogin = useAuth((s) => s.login);
  const setSession = useAuth((s) => s.setSession);
  useEffect(() => {
    if (!b.quote || b.seatNumbers.length === 0) navigate('/', { replace: true });
  }, [b.quote, b.seatNumbers.length, navigate]);

  // ── passenger + contact ────────────────────────────────────────────────
  const [passengers, setPassengers] = useState<PassengerDraft[]>(
    b.seatNumbers.map((seatNumber) => ({ seatNumber, fullName: '', age: undefined, gender: 'male' })),
  );
  const [email, setEmail] = useState(b.contactEmail);
  const [mobile, setMobile] = useState(b.contactPhone);

  // ── pay-time auth fork ──────────────────────────────────────────────────
  const [authStep, setAuthStep] = useState<AuthStep>(token ? 'done' : 'mobile');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Synchronous, render-independent double-click guard. React's `busy` state
  // disables the button, but a state update only takes effect on the NEXT
  // render — a genuinely rapid double-click/double-tap can fire this handler
  // twice before that render happens, each call reading the SAME stale
  // `busy === false` from its own closure. A ref is mutated and read
  // immediately, with no render in between, so it closes that gap: money
  // must never move twice because of a UI timing race, not just usually.
  const inFlight = useRef(false);

  // ── payment method ────────────────────────────────────────────────────────
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [vpa, setVpa] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [nbUser, setNbUser] = useState('');
  const [nbPass, setNbPass] = useState('');

  const testMethods = useQuery({ queryKey: ['test-methods'], queryFn: () => paymentsApi.testMethods(), retry: 0, staleTime: 60_000 });
  const banks = testMethods.data?.banks ?? [];
  const hints = testMethods.data?.hints ?? null;

  const totalMinor = b.quote?.totalMinor ?? 0;
  const currency = b.quote?.currency ?? 'INR';

  const passengersValid = passengers.every((p) => p.fullName.trim()) && mobile.trim().length >= 6;

  const buildInstrument = (): ChargeInstrument | null => {
    if (method === 'upi') return vpa.trim() ? { method, vpa: vpa.trim() } : null;
    if (method === 'net_banking') return bank && nbUser.trim() && nbPass ? { method, bank, username: nbUser.trim(), password: nbPass } : null;
    // credit/debit
    return cardNumber.trim() && expiry.trim() && cvv.trim()
      ? { method, cardNumber: cardNumber.trim(), expiry: expiry.trim(), cvv: cvv.trim(), holder: holder.trim() || undefined }
      : null;
  };
  const [termsAccepted, setTermsAccepted] = useState(false);
  const instrument = buildInstrument();
  const canPay = passengersValid && authStep === 'done' && !busy && termsAccepted && !!instrument;

  const proceedAuth = async () => {
    setErr(null); setBusy(true);
    try {
      if (authStep === 'mobile') {
        const res = await authApi.checkIdentity(mobile.trim());
        setAuthStep(res.registered ? 'password' : 'register');
      } else if (authStep === 'password') {
        await doLogin(mobile.trim(), password);
        setAuthStep('done');
        toast.success('Signed in');
      } else if (authStep === 'register') {
        await authApi.register({ fullName: regName.trim(), email: regEmail.trim(), mobile: mobile.trim(), password });
        setAuthStep('otp');
        toast.info('We emailed you a 6-digit code');
      } else if (authStep === 'otp') {
        const tokens = await authApi.verifyRegistration(regEmail.trim(), otp.trim());
        setSession(tokens, regEmail.trim());
        setAuthStep('done');
        toast.success('Account created');
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!instrument) return;
    if (inFlight.current) return; // synchronous guard — see the ref's comment above
    inFlight.current = true;
    setErr(null); setBusy(true);
    try {
      b.setContact(email || regEmail, mobile);
      b.setPassengers(passengers);
      const hold = await bookingsApi.hold({
        quoteId: b.quote!.quoteId,
        seatNumbers: b.seatNumbers,
        passengers: passengers.map((p) => ({ seatNumber: p.seatNumber, fullName: p.fullName.trim(), age: p.age, gender: p.gender })),
        contactEmail: (email || regEmail) || undefined,
        contactPhone: mobile || undefined,
      });
      const charged = await paymentsApi.charge(hold.bookingId, instrument);
      b.setConfirmed(hold.bookingId, charged.pnr ?? hold.pnr);
      toast.success('Payment successful');
      navigate('/confirmation', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Payment could not be completed');
      setBusy(false);
      inFlight.current = false;
    }
  };

  /** REAL payment path — Razorpay Checkout, used once PAYMENT_TEST_MODE is off. */
  const payWithRazorpay = async () => {
    if (inFlight.current) return; // synchronous guard — see the ref's comment above
    inFlight.current = true;
    setErr(null); setBusy(true);
    try {
      b.setContact(email || regEmail, mobile);
      b.setPassengers(passengers);
      const hold = await bookingsApi.hold({
        quoteId: b.quote!.quoteId,
        seatNumbers: b.seatNumbers,
        passengers: passengers.map((p) => ({ seatNumber: p.seatNumber, fullName: p.fullName.trim(), age: p.age, gender: p.gender })),
        contactEmail: (email || regEmail) || undefined,
        contactPhone: mobile || undefined,
      });
      const intent = await paymentsApi.createIntent(hold.bookingId);
      const callback = await openRazorpayCheckout(intent.clientPayload);
      // Cryptographically verified server-side — see PaymentService.verifyAndCapture.
      // The webhook confirms the same booking too (defence in depth); whichever
      // arrives first wins, the second is a no-op.
      const result = await paymentsApi.verify(hold.bookingId, callback);
      b.setConfirmed(hold.bookingId, result.pnr);
      toast.success('Payment successful');
      navigate('/confirmation', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Payment could not be completed');
      setBusy(false);
      inFlight.current = false;
    }
  };

  const isRealGateway = testMethods.data && !testMethods.data.testMode;
  const canPayReal = passengersValid && authStep === 'done' && !busy && termsAccepted;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Passengers */}
          <Card>
            <CardHeader title="Passenger details" />
            <CardBody className="flex flex-col gap-4">
              {passengers.map((p, i) => (
                <div key={p.seatNumber} className="rounded-md border border-border p-3">
                  <div className="mb-2 text-sm font-semibold text-text">Seat {p.seatNumber}</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Input label="Full name" value={p.fullName} onChange={(e) => setPassengers((a) => a.map((x, j) => j === i ? { ...x, fullName: e.target.value } : x))} />
                    <Input label="Age" type="number" value={p.age ?? ''} onChange={(e) => setPassengers((a) => a.map((x, j) => j === i ? { ...x, age: Number(e.target.value) || undefined } : x))} />
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-text">Gender</label>
                      <select value={p.gender} onChange={(e) => setPassengers((a) => a.map((x, j) => j === i ? { ...x, gender: e.target.value } : x))}
                        className="h-input rounded-input border border-border bg-surface px-input-x text-sm focus-ring">
                        <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
              <Input label="Contact mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} leftIcon={<Phone className="h-4 w-4" />} placeholder="+9198…" />
              <Input label="Contact email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail className="h-4 w-4" />} />
            </CardBody>
          </Card>

          {/* Pay-time auth fork */}
          {authStep !== 'done' && (
            <Card>
              <CardHeader title="Sign in to pay" subtitle="Your ticket is linked to your Ticketly account" />
              <CardBody className="flex flex-col gap-3">
                {authStep === 'mobile' && (
                  <>
                    <Input label="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} leftIcon={<Phone className="h-4 w-4" />} placeholder="Enter your mobile" />
                    <p className="text-xs text-text-muted">We’ll check if you already have an account.</p>
                  </>
                )}
                {authStep === 'password' && (
                  <>
                    <p className="text-sm text-text">Welcome back! Enter your password for <b>{mobile}</b>.</p>
                    <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<Lock className="h-4 w-4" />} />
                  </>
                )}
                {authStep === 'register' && (
                  <>
                    <p className="text-sm text-text">New here — let’s create your account.</p>
                    <Input label="Full name" value={regName} onChange={(e) => setRegName(e.target.value)} leftIcon={<User className="h-4 w-4" />} />
                    <Input label="Email" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} leftIcon={<Mail className="h-4 w-4" />} />
                    <Input label="Create password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<Lock className="h-4 w-4" />} hint="At least 8 characters" />
                  </>
                )}
                {authStep === 'otp' && (
                  <>
                    <p className="text-sm text-text">Enter the 6-digit code sent to <b>{regEmail}</b>.</p>
                    <Input label="Email OTP" value={otp} onChange={(e) => setOtp(e.target.value)} leftIcon={<ShieldCheck className="h-4 w-4" />} placeholder="••••••" />
                  </>
                )}
                {err && <p className="text-xs text-danger">{err}</p>}
                <Button onClick={proceedAuth} disabled={busy} fullWidth>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> :
                    authStep === 'mobile' ? 'Continue' : authStep === 'password' ? 'Sign in' : authStep === 'register' ? 'Create account & send OTP' : 'Verify & continue'}
                </Button>
              </CardBody>
            </Card>
          )}

          {/* Payment method — shown once signed in. Real gateway (Razorpay) needs
              none of this: its own Checkout modal collects UPI/card/etc. */}
          {authStep === 'done' && isRealGateway && (
            <Card>
              <CardHeader title="Payment" subtitle="You'll choose UPI, card, or net banking in the next step" />
              <CardBody className="flex items-center gap-3 rounded-md border border-border bg-surface-muted p-4 text-sm text-text-muted">
                <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
                Secured by Razorpay — your card/UPI details never touch Ticketly servers.
              </CardBody>
            </Card>
          )}

          {authStep === 'done' && !isRealGateway && (
            <Card>
              <CardHeader title="Payment method" subtitle="Choose how you’d like to pay" />
              <CardBody className="flex flex-col gap-4">
                {/* Method selector */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {METHOD_META.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMethod(value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors',
                        method === value ? 'border-primary bg-surface-muted text-text' : 'border-border text-text-muted hover:border-primary/40 hover:text-text',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Test-mode credential hint */}
                {testMethods.data?.testMode && hints && (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted p-3 text-xs text-text-muted">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <div>
                      <span className="font-semibold text-text">Test mode.</span>{' '}
                      {method === 'upi' && <>Use UPI ID <b className="text-text">{hints.upi}</b> to succeed (or <b>{hints.upiFailure}</b> to see a decline).</>}
                      {(method === 'credit_card' || method === 'debit_card') && <>Use card <b className="text-text">{hints.card}</b>, expiry <b className="text-text">{hints.cardExpiry}</b>, CVV <b className="text-text">{hints.cardCvv}</b>.</>}
                      {method === 'net_banking' && <>Any bank + username <b className="text-text">{hints.netbankingUser}</b>, password <b className="text-text">{hints.netbankingPassword}</b>.</>}
                    </div>
                  </div>
                )}

                {/* Method-specific fields */}
                {method === 'upi' && (
                  <Input label="UPI ID" value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@bank" leftIcon={<Smartphone className="h-4 w-4" />} />
                )}

                {(method === 'credit_card' || method === 'debit_card') && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Input label="Card number" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" inputMode="numeric" leftIcon={<CreditCard className="h-4 w-4" />} />
                    </div>
                    <Input label="Expiry (MM/YY)" value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="12/30" />
                    <Input label="CVV" value={cvv} onChange={(e) => setCvv(e.target.value)} placeholder="123" inputMode="numeric" type="password" />
                    <div className="sm:col-span-2">
                      <Input label="Name on card (optional)" value={holder} onChange={(e) => setHolder(e.target.value)} leftIcon={<User className="h-4 w-4" />} />
                    </div>
                  </div>
                )}

                {method === 'net_banking' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Select label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Select your bank"
                        options={banks.map((x) => ({ label: x, value: x }))} />
                    </div>
                    <Input label="Net-banking username" value={nbUser} onChange={(e) => setNbUser(e.target.value)} leftIcon={<User className="h-4 w-4" />} />
                    <Input label="Password" type="password" value={nbPass} onChange={(e) => setNbPass(e.target.value)} leftIcon={<Lock className="h-4 w-4" />} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Fare summary + pay */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <CardHeader title="Fare summary" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{b.seatNumbers.join(', ')}</span></div>
              <div className="flex justify-between border-t border-border pt-3 text-base"><span className="font-semibold">Total</span><span className="font-semibold">{formatMoney(totalMinor, currency)}</span></div>
              <label className="flex items-start gap-2 text-xs text-text-muted">
                <input type="checkbox" className="mt-0.5" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                <span>
                  I agree to the <Link to="/legal/terms" target="_blank" className="text-primary underline">Terms of Service</Link>,{' '}
                  <Link to="/legal/privacy" target="_blank" className="text-primary underline">Privacy Policy</Link>, and{' '}
                  <Link to="/legal/refund-policy" target="_blank" className="text-primary underline">Cancellation & Refund Policy</Link>.
                </span>
              </label>
              {err && authStep === 'done' && <p className="text-xs text-danger">{err}</p>}
              <Button
                className="mt-1"
                fullWidth
                disabled={isRealGateway ? !canPayReal : !canPay}
                onClick={isRealGateway ? payWithRazorpay : pay}
                leftIcon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              >
                Pay {formatMoney(totalMinor, currency)}
              </Button>
              <p className="text-center text-[11px] text-text-muted">
                {authStep !== 'done' ? 'Sign in above to continue' : isRealGateway ? 'Secured checkout · Razorpay' : 'Secured checkout · sandbox payment'}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
