import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Phone, Lock, Eye, EyeOff, Bus, ShieldCheck, Sparkles } from 'lucide-react';

import { Button, useToast } from '@/components/ui';
import { useAuth, homeForRoles } from '@/stores/auth';
import { SURFACE } from '@/lib/host';
import { ApiError } from '@/lib/api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const login = useAuth((s) => s.login);
  const status = useAuth((s) => s.status);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const user = await login(identifier.trim(), password);
      toast.success('Welcome back');
      navigate(from ?? homeForRoles(user.roles, SURFACE), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel — flat black, clean & minimal ── */}
      <aside className="relative hidden bg-primary text-primary-fg lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10">
            <Bus className="h-6 w-6" />
          </span>
          <span className="font-display text-2xl tracking-tight">Ticketly</span>
        </div>

        <div className="max-w-md">
          <p className="mb-4 inline-flex items-center gap-2 rounded-pill border border-white/20 px-3 py-1 text-xs font-medium text-white/80">
            <Sparkles className="h-3.5 w-3.5" /> Enterprise bus distribution platform
          </p>
          <h2 className="font-display text-4xl leading-tight xl:text-[2.7rem]">
            The command centre for modern bus travel.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">
            Inventory, pricing, payments and ticketing — one clean, fast console for every operator on the network.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm text-white/65">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Bank-grade security · encrypted PII · signed e-tickets
        </div>
      </aside>

      {/* ── Sign-in ── */}
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-fg">
              <Bus className="h-5 w-5" />
            </span>
            <span className="font-display text-xl text-text">Ticketly</span>
          </div>

          <h1 className="font-display text-4xl tracking-tight text-text">Welcome back</h1>
          <p className="mt-2 text-text-muted">Sign in to continue to your Ticketly workspace.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Mobile number or email"
                autoComplete="username"
                required
                className="h-12 w-full rounded-input border border-border bg-surface pl-10 pr-3 text-sm text-text transition-colors focus-ring hover:border-primary/30 focus:border-primary"
              />
            </div>

            <div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  className="h-12 w-full rounded-input border border-border bg-surface pl-10 pr-10 text-sm text-text transition-colors focus-ring hover:border-primary/30 focus:border-primary"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text" aria-label="Toggle password">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-text-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[var(--yb-color-primary)]" />
                Remember for 30 days
              </label>
              <Link className="font-medium text-primary hover:underline" to="/forgot-password">Forgot password</Link>
            </div>

            <Button type="submit" size="lg" fullWidth loading={status === 'authenticating'} className="mt-1">Sign in</Button>
          </form>

          <p className="mt-7 text-sm text-text-muted">
            New here?{' '}
            <Link to="/register" className="font-semibold text-primary hover:underline">Create an account</Link>
            {' '}·{' '}
            <Link to="/become-operator" className="font-semibold text-primary hover:underline">Become an operator</Link>
          </p>
          <p className="mt-4 text-xs text-text-muted">
            By clicking Sign in, you agree to our <a className="text-info hover:underline" href="#">terms of use</a> and <a className="text-info hover:underline" href="#">privacy policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
