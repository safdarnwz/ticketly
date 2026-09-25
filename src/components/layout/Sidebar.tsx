import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Search, Ticket, RotateCcw, Star, LifeBuoy,
  Megaphone, ShieldAlert, Bus, Building2, ClipboardList, Settings as SettingsIcon,
  Route as RouteIcon, Truck, Calendar, IndianRupee, TrendingUp, Radio, Users, BarChart3,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { isSuperAdmin, SURFACE_TENANT_SLUG } from '@/lib/host';

/** app.<slug>.ticketly.com — one operator's own console. Purely their own trading operations. */
const tenantAdminNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/routes', label: 'Routes & Stops', icon: RouteIcon },
  { to: '/fleet', label: 'Fleet & Crew', icon: Truck },
  { to: '/schedule', label: 'Schedule', icon: Calendar },
  { to: '/pricing', label: 'Pricing', icon: IndianRupee },
  { to: '/distribution', label: 'Distribution', icon: Radio },
  { to: '/promotions', label: 'Promotions', icon: TrendingUp },
  { to: '/branches', label: 'Branches', icon: Building2 },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/search', label: 'Search & Book', icon: Search },
  { to: '/bookings', label: 'Bookings', icon: Ticket },
  { to: '/refunds', label: 'Refunds', icon: RotateCcw },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
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
  { to: '/admin/analytics', label: 'Analytics & Billing', icon: TrendingUp },
  { to: '/cms', label: 'CMS & Offers', icon: Megaphone },
  { to: '/fraud', label: 'Risk & Fraud', icon: ShieldAlert },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar() {
  const nav = isSuperAdmin ? superAdminNav : tenantAdminNav;

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
