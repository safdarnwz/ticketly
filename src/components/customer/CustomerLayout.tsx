import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bus, Ticket, UserRound } from 'lucide-react';

import { Button } from '@/components/ui';
import { BackButton } from '@/components/layout/BackButton';
import { AnnouncementBanner } from '@/components/layout/AnnouncementBanner';
import { legalApi } from '@/lib/api/legal';
import { useAuth } from '@/stores/auth';

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

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-fg"><Bus className="h-5 w-5" /></div>
            <span className="font-display text-xl text-text">Ticketly</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/account"><Button variant="ghost" size="sm" leftIcon={<Ticket className="h-4 w-4" />}>My trips</Button></Link>
            {token && user ? (
              <>
                <span className="hidden text-sm text-text-muted sm:inline">{user.fullName}</span>
                <Button variant="outline" size="sm" onClick={() => { logout(); navigate('/'); }}>Sign out</Button>
              </>
            ) : (
              <Button size="sm" leftIcon={<UserRound className="h-4 w-4" />} onClick={() => navigate('/login')}>Sign in</Button>
            )}
          </nav>
        </div>
      </header>

      <AnnouncementBanner audience="customers" className="mx-auto w-full max-w-6xl" />

      <main className="flex-1">
        {showBack && (
          <div className="mx-auto max-w-6xl px-4 pt-3">
            <BackButton to={backTo} />
          </div>
        )}
        <Outlet />
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-text-muted sm:flex-row">
          <span>© Ticketly — book bus tickets across India</span>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/become-operator" className="hover:text-text">Become an operator</Link>
            {(legal.data?.items ?? []).map((p) => (
              <Link key={p.slug} to={`/legal/${p.slug}`} className="hover:text-text">{p.title}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
