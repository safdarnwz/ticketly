import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Phone, Lock, ShieldCheck } from 'lucide-react';

import { Button, Input, useToast } from '@/components/ui';
import { authApi } from '@/lib/api/auth';
import { useAuth } from '@/stores/auth';
import { ApiError } from '@/lib/api/client';

export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const setSession = useAuth((s) => s.setSession);

  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [form, setForm] = useState({ fullName: '', email: '', mobile: '', password: '' });
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      if (step === 'form') {
        await authApi.register(form);
        setStep('otp');
        toast.info('We emailed you a 6-digit code');
      } else {
        const tokens = await authApi.verifyRegistration(form.email, otp.trim());
        setSession(tokens, form.email);
        toast.success('Account created');
        navigate('/account', { replace: true });
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-center font-display text-4xl tracking-tight text-text">Create your account</h1>
      <p className="mt-2 text-center text-sm text-text-muted">Book faster and manage all your trips in one place</p>

      <div className="mt-8 flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card">
        {step === 'form' ? (
          <>
            <Input label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} leftIcon={<User className="h-4 w-4" />} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} leftIcon={<Mail className="h-4 w-4" />} />
            <Input label="Mobile number" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} leftIcon={<Phone className="h-4 w-4" />} />
            <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} leftIcon={<Lock className="h-4 w-4" />} hint="At least 8 characters" />
          </>
        ) : (
          <>
            <p className="text-sm text-text">Enter the 6-digit code sent to <b>{form.email}</b>.</p>
            <Input label="Email OTP" value={otp} onChange={(e) => setOtp(e.target.value)} leftIcon={<ShieldCheck className="h-4 w-4" />} placeholder="••••••" />
          </>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
        <Button onClick={submit} loading={busy} fullWidth size="lg">
          {step === 'form' ? 'Create account' : 'Verify & continue'}
        </Button>
      </div>

      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an account? <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
