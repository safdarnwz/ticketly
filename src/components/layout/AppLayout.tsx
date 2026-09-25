import { Outlet, useLocation } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AnnouncementBanner } from './AnnouncementBanner';
import { BackButton } from './BackButton';
import { isSuperAdmin } from '@/lib/host';

export function AppLayout() {
  const location = useLocation();
  // Same reasoning as CustomerLayout: rendered once here so every console
  // page gets it, rather than 40+ individual pages each needing to
  // remember to add their own. Hidden only on each surface's OWN home —
  // super-admin's is /admin/tenants, tenant-admin's is /dashboard; using
  // the wrong one would hide the button on a page that isn't actually
  // this surface's landing spot.
  const home = isSuperAdmin ? '/admin/tenants' : '/dashboard';
  const showBack = location.pathname !== home && location.pathname !== '/';
  // Same reasoning as CustomerLayout's BACK_TARGETS: /staff-trip/:tripId's
  // logical parent is /search (where staff picked the trip from), not the
  // non-existent /staff-trip the generic drop-last-segment fallback would
  // produce.
  const backTo = location.pathname.startsWith('/staff-trip') ? '/search' : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <AnnouncementBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-6 py-6">
            {showBack && <div className="mb-3"><BackButton to={backTo} /></div>}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
