import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Bus, ShieldCheck, ArrowLeft } from 'lucide-react';

import { Button, useToast } from '@/components/ui';
import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [identity, setIdentity] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await authApi.requestPasswordResetOtp(identity.trim());
      toast.success('A code has been sent — check your email/SMS');
      setStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await authApi.confirmPasswordReset(identity.trim(), code.trim(), newPassword);
      toast.success('Password reset — please sign in with your new password');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden bg-primary text-primary-fg lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10"><Bus className="h-6 w-6" /></span>
          <span className="font-display text-2xl tracking-tight">Ticketly</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/65">
          <ShieldCheck className="h-4 w-4 text-accent" /> Resetting your password signs you out everywhere else, for safety.
        </div>
      </aside>

      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>

          <h1 className="font-display text-4xl tracking-tight text-text">Reset your password</h1>
          <p className="mt-2 text-text-muted">
            {step === 'request' ? "We'll send a code to your registered email or mobile." : `Enter the code sent to ${identity} and your new password.`}
          </p>

          {step === 'request' ? (
            <form onSubmit={requestCode} className="mt-8 flex flex-col gap-4">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={identity} onChange={(e) => setIdentity(e.target.value)}
                  placeholder="Mobile number or email" autoComplete="username" required
                  className="h-12 w-full rounded-input border border-border bg-surface pl-10 pr-3 text-sm text-text transition-colors focus-ring hover:border-primary/30 focus:border-primary"
                />
              </div>
              {error && <p className="text-xs font-medium text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={busy} className="mt-1">Send code</Button>
            </form>
          ) : (
            <form onSubmit={confirmReset} className="mt-8 flex flex-col gap-4">
              <input
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code" inputMode="numeric" required
                className="h-12 w-full rounded-input border border-border bg-surface px-3 text-center text-lg tracking-[0.3em] text-text transition-colors focus-ring hover:border-primary/30 focus:border-primary"
              />
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type={show ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password" autoComplete="new-password" required minLength={8}
                  className="h-12 w-full rounded-input border border-border bg-surface pl-10 pr-10 text-sm text-text transition-colors focus-ring hover:border-primary/30 focus:border-primary"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text" aria-label="Toggle password">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && <p className="text-xs font-medium text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={busy} className="mt-1">Reset password</Button>
              <button type="button" onClick={() => setStep('request')} className="text-center text-xs text-text-muted hover:text-text">No code received? Try again</button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
