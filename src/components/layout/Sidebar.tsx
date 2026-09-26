import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  LayoutDashboard, Search, Ticket, RotateCcw, Star, LifeBuoy,
  Megaphone, ShieldAlert, Bus, Building2, ClipboardList, Settings as SettingsIcon,
  Route as RouteIcon, Truck, Calendar, IndianRupee, TrendingUp, Radio, Users, BarChart3, UserCog,
} from 'lucide-react';

import { authApi } from '@/lib/api/auth';
import { cn } from '@/lib/utils';
import { isSuperAdmin, SURFACE_TENANT_SLUG } from '@/lib/host';

/** app.<slug>.ticketly.com — one operator's own console. Purely their own trading operations. */
const tenantAdminNav: { to: string; label: string; icon: typeof Bus; needs: string[] }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, needs: [] },
  { to: '/trips', label: 'Trips & Charts', icon: Bus, needs: ['service:read', 'trip:manage', 'trip:operate'] },
  { to: '/routes', label: 'Routes & Stops', icon: RouteIcon, needs: ['route:read', 'stop:manage'] },
  { to: '/fleet', label: 'Fleet & Crew', icon: Truck, needs: ['vehicle:read', 'crew:manage'] },
  { to: '/operations', label: 'Operations', icon: ShieldAlert, needs: ['trip:operate'] },
  { to: '/schedule', label: 'Schedule', icon: Calendar, needs: ['service:read'] },
  { to: '/pricing', label: 'Pricing', icon: IndianRupee, needs: ['fare:read'] },
  { to: '/distribution', label: 'Distribution', icon: Radio, needs: ['agent:read'] },
  { to: '/promotions', label: 'Promotions', icon: TrendingUp, needs: ['route:manage'] },
  { to: '/branches', label: 'Branches', icon: Building2, needs: ['tenant:read'] },
  { to: '/staff', label: 'Staff', icon: UserCog, needs: ['user:read', 'role:manage', 'report:read'] },
  { to: '/customers', label: 'Customers', icon: Users, needs: ['booking:read'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, needs: ['report:read'] },
  { to: '/search', label: 'Search & Book', icon: Search, needs: ['booking:create'] },
  { to: '/bookings', label: 'Bookings', icon: Ticket, needs: ['booking:read'] },
  { to: '/refunds', label: 'Refunds', icon: RotateCcw, needs: ['payment:read', 'payment:refund'] },
  { to: '/reviews', label: 'Reviews', icon: Star, needs: ['tenant:read'] },
  { to: '/support', label: 'Support', icon: LifeBuoy, needs: ['booking:read'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, needs: ['tenant:read'] },
];

/**
 * app.ticketly.com — platform/super-admin console. Cross-tenant operator
 * management PLUS everything that's platform-wide, not per-operator (see
 * migration 0018): the one central storefront's content/offers, the shared
 * fraud-review queue, the one translation/FX catalog, DPDP privacy requests
 * (customers are tenant-less), and the console's own theme.
 */
const superAdminNav = [
  { to: '/admin/tenants', label: 'Operators', icon: Building2 },
  { to: '/admin/operators', label: 'Applications', icon: ClipboardList },
  { to: '/admin/bookings', label: 'Live bookings', icon: Activity },
  { to: '/admin/escalations', label: 'Support escalations', icon: LifeBuoy },
  { to: '/admin/analytics', label: 'Analytics & Billing', icon: TrendingUp },
  { to: '/cms', label: 'CMS & Offers', icon: Megaphone },
  { to: '/fraud', label: 'Risk & Fraud', icon: ShieldAlert },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar() {
  // Staff only see the menus their roles open (any one of `needs`); the API refuses the rest anyway.
  const me = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me, enabled: !isSuperAdmin, staleTime: 60_000 });
  const held = new Set(me.data?.permissions ?? []);
  const nav = isSuperAdmin
    ? superAdminNav
    : tenantAdminNav.filter((n) => n.needs.length === 0 || held.has('*') || n.needs.some((p) => held.has(p)));

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface text-text-muted md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-fg">
          <Bus className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-xl text-text">Ticketly</span>
          {!isSuperAdmin && SURFACE_TENANT_SLUG && (
            <span className="text-[11px] text-text-muted">{SURFACE_TENANT_SLUG}</span>
          )}
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-surface-muted text-text'
                  : 'text-text-muted hover:bg-surface-muted hover:text-text',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />
                )}
                <Icon className={cn('h-[18px] w-[18px]', isActive && 'text-accent')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-4 text-[11px] leading-relaxed text-text-muted">
        {isSuperAdmin ? 'Ticketly Platform Admin' : 'Ticketly Console'} · v1.0
      </div>
    </aside>
  );
}
