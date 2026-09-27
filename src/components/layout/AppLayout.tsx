import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';

import { Sidebar, SidebarContent, useConsoleNav } from './Sidebar';
import { Topbar } from './Topbar';
import { AnnouncementBanner } from './AnnouncementBanner';
import { BackButton } from './BackButton';
import { isSuperAdmin } from '@/lib/host';
import { useIsAgent, useIsCrew } from '@/lib/useAgent';
import { cn } from '@/lib/utils';

/** Where a travel agent's login may go on the operator console; anything else is staff-only. */
const AGENT_PATHS = ['/agent', '/search', '/staff-trip', '/me', '/legal'];
/** Where a conductor / driver login may go: the crew app and their own account. */
const CREW_PATHS = ['/crew', '/me'];

export function AppLayout() {
  const location = useLocation();
  const { isAgent, loading } = useIsAgent();
  const { isCrew } = useIsCrew();
  const { nav, kind } = useConsoleNav();
  const [drawer, setDrawer] = useState(false);
  // A new page closes the phone menu.
  useEffect(() => setDrawer(false), [location.pathname]);
  // Field users (agents, crew) get a thumb-reach tab bar on phones instead of a menu.
  const tabs = kind === 'agent' || kind === 'crew' ? nav.slice(0, 5) : null;
  // Same reasoning as CustomerLayout: rendered once here so every console
  // page gets it, rather than 40+ individual pages each needing to
  // remember to add their own. Hidden only on each surface's OWN home —
  // super-admin's is /admin/tenants, tenant-admin's is /dashboard; using
  // the wrong one would hide the button on a page that isn't actually
  // this surface's landing spot.
  const home = isSuperAdmin ? '/admin/tenants' : isAgent ? '/agent' : isCrew ? '/crew' : '/dashboard';
  const inside = (paths: string[]) => paths.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  if (isCrew && !inside(CREW_PATHS)) return <Navigate to="/crew" replace />;
  if (isAgent && !AGENT_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`)))
    return <Navigate to="/agent" replace />;
  const showBack = location.pathname !== home && location.pathname !== '/';
  // Same reasoning as CustomerLayout's BACK_TARGETS: /staff-trip/:tripId's
  // logical parent is /search (where staff picked the trip from), not the
  // non-existent /staff-trip the generic drop-last-segment fallback would
  // produce.
  const backTo = location.pathname.startsWith('/staff-trip') ? '/search' : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-text/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col rounded-r-[28px] bg-primary shadow-lg">
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenu={tabs ? undefined : () => setDrawer(true)} />
        <AnnouncementBanner />
        <main className="flex-1 overflow-y-auto">
          <div className={cn('mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6', tabs && 'pb-24 md:pb-6')}>
            {showBack && <div className="mb-3"><BackButton to={backTo} /></div>}
            {loading && !isSuperAdmin ? null : <Outlet />}
          </div>
        </main>
        {tabs && (
          <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(47,62,92,0.08)] backdrop-blur md:hidden">
            <div className="mx-auto flex h-[64px] max-w-lg">
              {tabs.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/agent' || to === '/crew'} className={({ isActive }) => cn('flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold', isActive ? 'text-accent' : 'text-text-muted')}>
                  {({ isActive }) => (
                    <>
                      <span className={cn('flex h-7 w-11 items-center justify-center rounded-pill', isActive && 'bg-accent/10')}><Icon className="h-5 w-5" /></span>
                      <span className="max-w-full truncate px-1">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
