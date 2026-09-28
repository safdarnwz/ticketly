import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bus, Home, Search, Ticket, UserRound } from 'lucide-react';

import { BackButton } from '@/components/layout/BackButton';
import { AnnouncementBanner } from '@/components/layout/AnnouncementBanner';
import { legalApi } from '@/lib/api/legal';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';

export function CustomerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const logout = useAuth((s) => s.logout);
  const legal = useQuery({ queryKey: ['legal-pages'], queryFn: legalApi.list, staleTime: 10 * 60_000 });
  // Every page gets a Back button EXCEPT the landing page itself — there's
  // nowhere logical to go "back" TO from the entry point, and a button
  // that just sits there unable to do anything useful is worse than no
  // button at all. Rendered here once, at the layout level, rather than
  // on each of the 40+ pages individually — a page added later gets it
  // automatically, and it can never end up on some pages but not others
  // by oversight.
  const showBack = location.pathname !== '/';
  // The generic "drop the last path segment" fallback in BackButton works
  // for a plain list/detail pair (e.g. /bookings/:id -> /bookings), but
  // several customer routes don't follow that shape at all — /trip/:id's
  // logical parent is /results, not the non-existent /trip; /legal/:slug's
  // is /, not the non-existent /legal. An explicit map for exactly the
  // routes where the generic heuristic would send someone to a page that
  // doesn't exist.
  const BACK_TARGETS: [prefix: string, to: string][] = [
    ['/trip', '/results'],
    ['/legal/', '/'],
    ['/track/', '/'],
    ['/connecting/checkout', '/connecting/results'],
    ['/connecting/results', '/'],
    ['/checkout', '/results'],
    ['/confirmation', '/'],
    ['/results', '/'],
    ['/account', '/'],
    ['/become-operator', '/'],
  ];
  const backTo = BACK_TARGETS.find(([prefix]) => location.pathname.startsWith(prefix))?.[1];

  const initial = user?.fullName?.trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-primary-fg"><Bus className="h-[18px] w-[18px]" /></span>
            <span className="text-lg font-semibold tracking-tight text-text">ticketly</span>
          </Link>
          <nav className="flex items-center gap-1.5">
            <NavLink
              to="/account"
              className={({ isActive }) => cn('hidden h-10 items-center gap-2 rounded-pill px-4 text-sm font-medium sm:flex', isActive ? 'bg-surface-muted text-text' : 'text-text-muted hover:text-text')}
            >
              <Ticket className="h-4 w-4" /> My trips
            </NavLink>
            {token && user ? (
              <>
                <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent sm:flex" title={user.fullName}>{initial}</span>
                <button type="button" className="h-10 rounded-pill px-3 text-sm font-medium text-text-muted hover:text-text" onClick={() => { logout(); navigate('/'); }}>Sign out</button>
              </>
            ) : (
              <Link to="/login" className="flex h-10 items-center gap-2 rounded-pill bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90">
                <UserRound className="h-4 w-4" /> Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <AnnouncementBanner audience="customers" className="mx-auto w-full max-w-6xl" />

      <main className="flex-1 pb-28 sm:pb-0">
        {showBack && (
          <div className="mx-auto max-w-6xl px-4 pt-4">
            <BackButton to={backTo} />
          </div>
        )}
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-28 pt-8 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between sm:pb-8">
          <span>© Ticketly · Bus tickets across India</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/become-operator" className="hover:text-text">Become an operator</Link>
            {(legal.data?.items ?? []).map((p) => (
              <Link key={p.slug} to={`/legal/${p.slug}`} className="hover:text-text">{p.title}</Link>
            ))}
          </div>
        </div>
      </footer>
      {/* Phone tab bar — a floating ink pill with the three places a traveller goes. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:hidden">
        <div className="mx-auto grid h-16 max-w-sm grid-cols-3 gap-1 rounded-pill bg-primary p-1.5 shadow-lg">
          {[
            { to: '/', label: 'Home', icon: Home, end: true },
            { to: '/results', label: 'Search', icon: Search, end: false },
            { to: '/account', label: 'My trips', icon: Ticket, end: false },
          ].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn('flex items-center justify-center gap-2 rounded-pill text-sm font-medium', isActive ? 'bg-white text-text' : 'text-white/70')}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
