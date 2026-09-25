import { useState } from 'react';
import { Lock, Mail, Phone, ShieldCheck, User } from 'lucide-react';

import { Button, Input, useToast } from '@/components/ui';
import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { isEmail } from '@/lib/checkout';
import { useAuth } from '@/stores/auth';

type Step = 'mobile' | 'password' | 'register' | 'otp';

/**
 * Sign in or create an account at checkout, keyed on the contact mobile:
 * a known number asks for its password; a new one registers and verifies
 * an email code. Calls onDone once signed in.
 */
export function CheckoutSignIn({ mobile, onDone }: { mobile: string; onDone: (email?: string) => void }) {
  const toast = useToast();
  const doLogin = useAuth((s) => s.login);
  const setSession = useAuth((s) => s.setSession);
  const [step, setStep] = useState<Step>('mobile');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const next = async () => {
    setErr('');
    if (step === 'register') {
      if (name.trim().length < 2) return setErr('Enter your name');
      if (!isEmail(email)) return setErr('Enter a valid email — the code is sent there');
      if (password.length < 8) return setErr('Password must be at least 8 characters');
    }
    if (step === 'otp' && !/^\d{6}$/.test(otp.trim())) return setErr('Enter the 6-digit code');
    setBusy(true);
    try {
      if (step === 'mobile') {
        const res = await authApi.checkIdentity(mobile);
        setStep(res.registered ? 'password' : 'register');
      } else if (step === 'password') {
        await doLogin(mobile, password);
        toast.success('Signed in');
        onDone();
      } else if (step === 'register') {
        await authApi.register({ fullName: name.trim(), email: email.trim(), mobile, password });
        setStep('otp');
        toast.info(`We emailed a 6-digit code to ${email.trim()}`);
      } else {
        const tokens = await authApi.verifyRegistration(email.trim(), otp.trim());
        setSession(tokens, email.trim());
        toast.success('Account created');
        onDone(email.trim());
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong — please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {step === 'mobile' && (
        <p className="flex items-center gap-2 text-sm text-text"><Phone className="h-4 w-4" /> Continue with <b>{mobile}</b></p>
      )}
      {step === 'password' && (
        <>
          <p className="text-sm text-text">Welcome back — enter the password for <b>{mobile}</b>.</p>
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<Lock className="h-4 w-4" />} />
          <a href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</a>
        </>
      )}
      {step === 'register' && (
        <>
          <p className="text-sm text-text">New to Ticketly — create your account to get your ticket.</p>
          <Input label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} leftIcon={<User className="h-4 w-4" />} />
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail className="h-4 w-4" />} />
          <Input label="Create password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<Lock className="h-4 w-4" />} hint="At least 8 characters" />
        </>
      )}
      {step === 'otp' && (
        <>
          <p className="text-sm text-text">Enter the code sent to <b>{email}</b>.</p>
          <Input label="Email code" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} leftIcon={<ShieldCheck className="h-4 w-4" />} placeholder="6 digits" />
        </>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        {step !== 'mobile' && (
          <Button variant="ghost" onClick={() => { setStep('mobile'); setErr(''); }} disabled={busy}>Back</Button>
        )}
        <Button onClick={() => void next()} loading={busy} fullWidth>
          {step === 'mobile' ? 'Continue' : step === 'password' ? 'Sign in' : step === 'register' ? 'Create account & send code' : 'Verify & continue'}
        </Button>
      </div>
    </div>
  );
}
